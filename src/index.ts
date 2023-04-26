import { Parser } from "acorn";
import { BaseNode, AssignmentExpression } from "estree";
import { getParentsOf, isNode, searchNodes } from "./acorn-utils";
import type { Plugin } from 'vite';

const PureFunctions = ['__decorate', '__decorateClass'];

function findVariablesAliases(rootNode: BaseNode): Record<string, string[]> {
    const extractAssignmentIdentifiers = (assignmentExpression: AssignmentExpression) => {
        let extracted = [(assignmentExpression.left as any).name];
        if (assignmentExpression.right !== null &&
            typeof(assignmentExpression.right) === 'object' &&
            assignmentExpression.right.type === 'AssignmentExpression' &&
            assignmentExpression.right.operator === '=') {
            extracted = extracted.concat(extractAssignmentIdentifiers(assignmentExpression.right));
        }
        return extracted;
    };
    const output: Record<string, string[]> = {};
    const selectedNodes = searchNodes(rootNode, 'VariableDeclaration');
    for (const selectedNode of selectedNodes) {
        for (const declarator of selectedNode.declarations) {
            if (declarator.init !== null &&
                typeof(declarator.init) === 'object' &&
                declarator.init.type === 'AssignmentExpression' &&
                declarator.init.operator === '=') {
                const aliases = extractAssignmentIdentifiers(declarator.init);
                if (aliases.length > 0) {
                    aliases.unshift(declarator.id.name);
                }
                for (const alias of aliases) {
                    output[alias] = aliases.filter((i) => i !== alias);
                }
            }
        }
    }
    return output;
}

/**
 * Add a "/* @__PURE__ *\/" comment before any declaration of __decorate utility to allow for tree shaking.
 */
export default function TreeShakableDecorators(): Plugin {
    return {
        name: 'pure-decorators',
        apply: 'build',

        async transform(code: string, id: string) {
            try {
                if (!id.match(/\.ts$|(\?|&)lang\.ts/)) {
                    return null;
                }
                const rootNode = Parser.parse(code, {ecmaVersion: 'latest', sourceType: 'module'});
                const variablesAliases = findVariablesAliases(rootNode);
                let selectedNodes = searchNodes(rootNode, 'CallExpression').filter((node) => {
                    return PureFunctions.indexOf(node.callee.name) > -1;
                }).sort((a, b) => b.start - a.start);

                const modules: Record<string, {aliases: string[], placeholder: string}> = {};
                const extractedDeclarations = [];
                for (let selectedNode of selectedNodes) {
                    const moduleNames = [];
                    const parents = getParentsOf(selectedNode, rootNode);

                    if (selectedNode.arguments?.length > 1 && selectedNode.arguments[1].object?.type === 'Identifier') {
                        moduleNames.push(selectedNode.arguments[1].object.name);
                    }
                    if (parents.length > 1) {
                        selectedNode = parents[1];
                    }
                    extractedDeclarations.push(code.substring(selectedNode.start, selectedNode.end));
                    code = code.substring(0, selectedNode.start) + code.substring(selectedNode.end);

                    for (let i = parents.length - 1; i > 0; --i) {
                        const parent = parents[i];
                        if (isNode<AssignmentExpression & {left: any}>(parent, 'AssignmentExpression') && moduleNames.indexOf(parent.left.name) < 0) {
                            moduleNames.push(parent.left.name);
                        }
                    }
                    if (moduleNames.length > 0) {
                        const moduleName = moduleNames[0];
                        const placeholder = `__##${moduleName}##__`;
                        if (typeof (modules[moduleName]) === 'undefined') {
                            modules[moduleName] = {aliases: moduleNames, placeholder};
                            code = code.substring(0, selectedNode.start) + placeholder + code.substring(selectedNode.start);
                        }
                    }
                }
                const indexedByModule = extractedDeclarations.reduce((index: any, item) => {
                    for (const module of Object.keys(modules)) {
                        for (const alias of modules[module].aliases) {
                            if (item.includes(alias)) {
                                if (typeof(index[module]) === 'undefined') {
                                    index[module] = [];
                                }
                                index[module].push(item);
                                return index;
                            }
                        }
                    }
                    throw `Module not found in declaration "${item}".`;
                }, {});

                for (const moduleName of Object.keys(indexedByModule)) {
                    let inner = indexedByModule[moduleName].reverse().join("\n");
                    for (const alias of modules[moduleName].aliases) {
                        const escapedAlias = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                        inner = inner.replaceAll(new RegExp(`(?:\\s|\\b)${escapedAlias}(?:\\s|\\b)`, 'g'), '_');
                    }
                    const moduleNameWithAliases = [moduleName].concat(variablesAliases[moduleName] || []).join(' = ');
                    code = code.replace(modules[moduleName].placeholder, `
${moduleNameWithAliases} = /**!PURE*/ ((_) => {
    ${inner};
    return _;
})(${moduleName});
`);
                }
                for (const module of Object.keys(modules)) {
                    code = code.replace(modules[module].placeholder, '');
                }
                return code;
            } catch (e) {
                console.log(e);
            }
        },

        generateBundle(options, bundle) {
            for (const fileName of Object.keys(bundle)) {
                const chunk: any = bundle[fileName];
                if (typeof(chunk) === 'object' && typeof(chunk.code) === 'string') {
                    chunk.code = chunk.code.replaceAll(/\/\*\*\!PURE\*\/\s*/g, '/* @__PURE__ */ ');
                }
            }
        },
    };
}
