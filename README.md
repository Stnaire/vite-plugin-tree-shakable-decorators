# vite-plugin-tree-shakable-decorators

Make your TypeScript decorators tree-shakable.

Take the following example:

```ts
@Component()
export class Dialog {
    @Prop({ required: true })
    public title!: string;
}
```

Will generate this kind of code:
```js
let Dialog = class {
};
__decorate([
  Prop({required: true})
], Dialog.prototype, "title", void 0);
Dialog = __decorate([
  Component
], Dialog);
```

The problem is that the `__decorate` call is in the global scope. And because it uses `Dialog`, both the decorators and the component will always be included in the build, even if unused.

If you're building a lib for example it's a big issue because your end users will definitely not want all your components to be included in their build when they only use a few.

This plugin will wrap the decorators declarations into an IIFE marked as `/* @__PURE__ */`:
```js
let Dialog =  class Dialog {
};
Dialog = /* @__PURE__ */ ((_) => {
    __decorate([
        Prop({required: true})
    ], _.prototype, "title", void 0);
    return __decorate([
        Component
    ], _);
})(Dialog);
```

This way the `Dialog` class and its decorators will only be included in the build if `Dialog` is actually imported.

## Install

- npm

```bash
npm i vite-plugin-tree-shakable-decorators --save-dev
```

- yarn

```bash
yarn add -D vite-plugin-tree-shakable-decorators
```

- pnpm

```bash
pnpm add -D vite-plugin-tree-shakable-decorators
```

## Usage

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import TreeShakableDecorators from 'vite-plugin-tree-shakable-decorators';

export default defineConfig({
  plugins: [TreeShakableDecorators()],
  ...
});
```
