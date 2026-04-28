export default function (babel) {
  const { types: t } = babel;

  function getName(nameNode) {
    if (nameNode.type === 'JSXIdentifier') {
      return nameNode.name;
    } else if (nameNode.type === 'JSXMemberExpression') {
      return getName(nameNode.object) + '.' + nameNode.property.name;
    } else if (nameNode.type === 'JSXNamespacedName') {
      return nameNode.namespace.name + ':' + nameNode.name.name;
    }
    return '';
  }

  return {
    name: 'solid-tv-jsx-locator',
    visitor: {
      // Run inside Program.enter so our traversal fires BEFORE the SolidJS
      // JSX plugin transforms (and removes) JSX nodes.
      Program: {
        enter(programPath, state) {
          const fileName = state.file.opts.filename || '';
          const cwd = state.file.opts.cwd || '';
          const relativePath = fileName.startsWith(cwd)
            ? fileName.slice(cwd.length + 1)
            : fileName;

          programPath.traverse({
            JSXElement(path) {
              const nameNode = path.node.openingElement.name;
              const name = getName(nameNode);

              // Only process capitalized names (components)
              if (!name || !/^[A-Z]/.test(name)) return;

              const attributes = path.node.openingElement.attributes;

              // Add componentName if not present
              if (
                !attributes.some(
                  (attr) =>
                    t.isJSXAttribute(attr) &&
                    attr.name.name === 'componentName',
                )
              ) {
                attributes.push(
                  t.jsxAttribute(
                    t.jsxIdentifier('componentName'),
                    t.stringLiteral(name),
                  ),
                );
              }

              // Add componentLocation if not present
              if (
                !attributes.some(
                  (attr) =>
                    t.isJSXAttribute(attr) &&
                    attr.name.name === 'componentLocation',
                )
              ) {
                const location = path.node.loc;
                if (location) {
                  const source = `${relativePath}:${location.start.line}:${location.start.column}`;
                  attributes.push(
                    t.jsxAttribute(
                      t.jsxIdentifier('componentLocation'),
                      t.stringLiteral(source),
                    ),
                  );
                }
              }
            },
          });
        },
      },
    },
  };
}
