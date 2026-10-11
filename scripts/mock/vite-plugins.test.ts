import { describe, expect, it } from 'vitest';

import { scopeCss } from './vite-plugins';

describe('scopeCss', () => {
  it('moves the tokens off :root onto the embedded root', () => {
    expect(scopeCss(':root {\n  --accent: #ff7100;\n}')).toBe(
      '.edssi-theme {\n  --accent: #ff7100;\n}',
    );
  });

  it('keeps the document-wide rules inside it, with no more specificity', () => {
    const css =
      '*,\n*::before {\n  box-sizing: border-box;\n}\n:where(button) {\n  cursor: pointer;\n}';
    expect(scopeCss(css)).toBe(
      ':where(.edssi-theme) *,\n:where(.edssi-theme) *::before {\n  box-sizing: border-box;\n}\n' +
        ':where(.edssi-theme) :where(button) {\n  cursor: pointer;\n}',
    );
  });

  it("leaves the app's own classes, at-rules and indented lines alone", () => {
    const css =
      '.hud {\n  color: red;\n}\n@media (width > 1px) {\n  body {\n    margin: 0;\n  }\n}';
    expect(scopeCss(css)).toBe(css);
  });

  it('sizes by the embedded root rather than the viewport', () => {
    expect(scopeCss('.hud {\n  height: 100vh;\n  width: calc(100vw - 32px);\n}')).toBe(
      '.hud {\n  height: 100%;\n  width: calc(100% - 32px);\n}',
    );
  });

  it('leaves the VR panel rule matching nothing outside the app', () => {
    expect(scopeCss(':root.vr {\n  background: transparent;\n}')).toBe(
      ':root.vr {\n  background: transparent;\n}',
    );
  });
});
