// Holo Folder design rules: point UI code at the shared primitives instead of hand-rolled one-offs.
// Loaded by oxlint through `jsPlugins` in .oxlintrc.json. See .agents/skills/building-ui and design-system.

const PRIMITIVE_FILES = /components\/ui\/(overlay-dialog|toast)\.tsx$/;

/** Every string literal inside a JSX attribute value (plain strings, templates, cn()/clsx() arguments). */
function attributeStrings(value) {
  const out = [];
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'Literal' && typeof node.value === 'string') out.push(node.value);
    if (node.type === 'TemplateLiteral') for (const quasi of node.quasis) out.push(quasi.value.cooked ?? '');
    for (const key of Object.keys(node)) {
      if (key === 'parent' || key === 'loc' || key === 'range') continue;
      const child = node[key];
      if (Array.isArray(child)) child.forEach(visit);
      else if (child && typeof child === 'object' && typeof child.type === 'string') visit(child);
    }
  };
  visit(value);
  return out;
}

const attributeName = (attribute) => (attribute.name?.type === 'JSXIdentifier' ? attribute.name.name : null);
const filename = (context) => context.filename ?? context.getFilename?.() ?? '';

const noHandrolledOverlay = {
  meta: {
    type: 'suggestion',
    docs: { description: 'Use OverlayDialog instead of a hand-rolled fixed full-screen layer.' },
  },
  create(context) {
    if (PRIMITIVE_FILES.test(filename(context))) return {};
    return {
      JSXAttribute(node) {
        if (attributeName(node) !== 'className') return;
        const classes = attributeStrings(node.value).join(' ').split(/\s+/);
        if (classes.includes('fixed') && classes.includes('inset-0')) {
          context.report({
            node,
            message:
              'Hand-rolled full-screen layer. Use OverlayDialog (components/ui/overlay-dialog.tsx) for sheets, modals and menus. See the building-ui skill.',
          });
        }
      },
    };
  },
};

const noRoleDialog = {
  meta: {
    type: 'suggestion',
    docs: { description: 'Dialogs come from OverlayDialog, not a role="dialog" element.' },
  },
  create(context) {
    if (PRIMITIVE_FILES.test(filename(context))) return {};
    return {
      JSXAttribute(node) {
        if (attributeName(node) !== 'role') return;
        const roles = attributeStrings(node.value);
        if (roles.some((role) => role === 'dialog' || role === 'alertdialog')) {
          context.report({
            node,
            message:
              'role="dialog" on a custom element. Use OverlayDialog, which renders a native <dialog> with every dismissal path. See the adding-an-overlay-or-sheet skill.',
          });
        }
      },
    };
  },
};

const primaryButtonUsesHoloAction = {
  meta: {
    type: 'suggestion',
    docs: { description: 'A button filled with the primary colour should use the Button primitive or holo-action.' },
  },
  create(context) {
    return {
      JSXOpeningElement(node) {
        if (node.name?.type !== 'JSXIdentifier' || node.name.name !== 'button') return;
        const className = node.attributes.find((a) => a.type === 'JSXAttribute' && attributeName(a) === 'className');
        if (!className) return;
        const classes = attributeStrings(className.value).join(' ').split(/\s+/);
        const primaryFill = classes.some((c) => /^bg-primary$/.test(c));
        if (primaryFill && !classes.includes('holo-action')) {
          context.report({
            node,
            message:
              'Primary-filled <button> without holo-action. Use <Button> (components/ui/button.tsx) or add holo-action so primary actions look the same everywhere. See the building-ui skill.',
          });
        }
      },
    };
  },
};

export default {
  meta: { name: 'holo-design' },
  rules: {
    'no-handrolled-overlay': noHandrolledOverlay,
    'no-role-dialog': noRoleDialog,
    'primary-button-uses-holo-action': primaryButtonUsesHoloAction,
  },
};
