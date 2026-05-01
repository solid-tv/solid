import { createFilter, type Plugin } from 'vite';

export interface HexColorTransformOptions {
  include?: string | string[];
  exclude?: string | string[];
}

export default function hexColorTransform(
  options: HexColorTransformOptions = {},
): Plugin {
  const filter = createFilter(options.include, options.exclude);

  return {
    name: 'vite-plugin-hex-color-transform',

    transform(code, id) {
      if (!filter(id)) {
        return null;
      }

      const hexColorRegex =
        /["']#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3}|[A-Fa-f0-9]{8}|[A-Fa-f0-9]{4})["']/g;

      const convertHexTo0x = (_match: string, p1: string) => {
        let hex = p1;

        if (hex.length === 3) {
          hex =
            hex
              .split('')
              .map((char) => char + char)
              .join('') + 'FF';
        } else if (hex.length === 4) {
          const alpha = hex[3]! + hex[3]!;
          hex =
            hex
              .slice(0, 3)
              .split('')
              .map((char) => char + char)
              .join('') + alpha;
        } else if (hex.length === 6) {
          hex += 'FF';
        }

        return `0x${hex.toUpperCase()}`;
      };

      const transformedCode = code.replace(hexColorRegex, convertHexTo0x);

      return {
        code: transformedCode,
        map: null,
      };
    },
  };
}
