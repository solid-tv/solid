import * as lngr from '@solidtv/renderer';
import * as lngr_canvas_shaders from '@solidtv/renderer/canvas/shaders';
import * as lngr_webgl_shaders from '@solidtv/renderer/webgl/shaders';

import type {
  HolePunchProps as ShaderHolePunchProps,
  LinearGradientProps as ShaderLinearGradientProps,
  RadialGradientProps as ShaderRadialGradientProps,
  RoundedProps as ShaderRoundedProps,
  ShadowProps as ShaderShadowProps,
} from '@solidtv/renderer';
import { type WebGlShaderType as WebGlShader } from '@solidtv/renderer/webgl';
import { type CanvasShaderType as CanvasShader } from '@solidtv/renderer/canvas';
export {
  ShaderHolePunchProps,
  ShaderLinearGradientProps,
  ShaderRadialGradientProps,
  ShaderRoundedProps,
  ShaderShadowProps,
};
export { WebGlShader };
export { CanvasShader };

import { SHADERS_ENABLED, isDomRendererActive } from './config.js';
import type { CoreShaderManager } from './intrinsicTypes.js';
import { IRendererShaderManager } from './dom-renderer/domRendererTypes.js';

export type Vec4 = [x: number, y: number, z: number, w: number];

export interface ShaderBorderProps extends lngr.BorderProps {
  /** Distance between the border and element edges. */
  gap: number;
  /**
   * If `false`, the border is drawn outside the element. \
   * If `true`, the border is drawn inside the element.
   * @default true
   */
  inset: boolean;
}

export type ShaderBorderPrefixedProps = {
  [P in keyof ShaderBorderProps as `border-${P}`]: ShaderBorderProps[P];
};
export type ShaderShadowPrefixedProps = {
  [P in keyof ShaderShadowProps as `shadow-${P}`]: ShaderShadowProps[P];
};

export type ShaderRoundedWithShadowProps = ShaderRoundedProps &
  ShaderShadowPrefixedProps;
export type ShaderRoundedWithBorderProps = ShaderRoundedProps &
  ShaderBorderPrefixedProps;
export type ShaderRoundedWithBorderAndShadowProps = ShaderRoundedProps &
  ShaderShadowPrefixedProps &
  ShaderBorderPrefixedProps;

export type RendererShader<Props extends object> =
  | WebGlShader<Props>
  | CanvasShader<Props>;

export type ShaderRounded = RendererShader<ShaderRoundedProps>;
export type ShaderShadow = RendererShader<ShaderShadowProps>;
export type ShaderRoundedWithBorder =
  RendererShader<ShaderRoundedWithBorderProps>;
export type ShaderRoundedWithShadow =
  RendererShader<ShaderRoundedWithShadowProps>;
export type ShaderRoundedWithBorderAndShadow =
  RendererShader<ShaderRoundedWithBorderAndShadowProps>;
export type ShaderHolePunch = RendererShader<ShaderHolePunchProps>;
export type ShaderRadialGradient = RendererShader<ShaderRadialGradientProps>;
export type ShaderLinearGradient = RendererShader<ShaderLinearGradientProps>;

function calcFactoredRadiusArray(
  radius: Vec4,
  width: number,
  height: number,
  out: Vec4 = [0, 0, 0, 0],
): Vec4 {
  [out[0], out[1], out[2], out[3]] = radius;
  const factor = Math.min(
    width / Math.max(width, radius[0] + radius[1]),
    width / Math.max(width, radius[2] + radius[3]),
    height / Math.max(height, radius[0] + radius[3]),
    height / Math.max(height, radius[1] + radius[2]),
    1,
  );
  out[0] *= factor;
  out[1] *= factor;
  out[2] *= factor;
  out[3] *= factor;
  return out;
}

function toValidVec4(value: unknown): Vec4 {
  if (typeof value === 'number') {
    return [value, value, value, value];
  }
  if (Array.isArray(value)) {
    switch (value.length) {
      default:
      case 4:
        return value as Vec4;
      case 3:
        return [value[0], value[1], value[2], value[0]];
      case 2:
        return [value[0], value[1], value[0], value[1]];
      case 1:
        return [value[0], value[0], value[0], value[0]];
      case 0:
        break;
    }
  }
  return [0, 0, 0, 0];
}

function isCanvas(
  shManager: CoreShaderManager | IRendererShaderManager,
): boolean {
  return 'stage' in shManager && shManager.stage.renderer.mode === 'canvas';
}

function canUseShaders(): boolean {
  return SHADERS_ENABLED && !isDomRendererActive();
}

export function registerDefaultShaderRounded(
  shManager: IRendererShaderManager,
) {
  if (canUseShaders())
    shManager.registerShaderType(
      'rounded',
      isCanvas(shManager)
        ? lngr_canvas_shaders.Rounded
        : lngr_webgl_shaders.Rounded,
    );
}
export function registerDefaultShaderShadow(shManager: CoreShaderManager) {
  if (canUseShaders())
    shManager.registerShaderType(
      'shadow',
      isCanvas(shManager)
        ? lngr_canvas_shaders.Shadow
        : lngr_webgl_shaders.Shadow,
    );
}
export function registerDefaultShaderRoundedWithBorder(
  shManager: CoreShaderManager,
) {
  if (canUseShaders())
    shManager.registerShaderType(
      'roundedWithBorder',
      isCanvas(shManager)
        ? lngr_canvas_shaders.RoundedWithBorder
        : lngr_webgl_shaders.RoundedWithBorder,
    );
}
export function registerDefaultShaderRoundedWithShadow(
  shManager: CoreShaderManager,
) {
  if (canUseShaders())
    shManager.registerShaderType(
      'roundedWithShadow',
      isCanvas(shManager)
        ? lngr_canvas_shaders.RoundedWithShadow
        : lngr_webgl_shaders.RoundedWithShadow,
    );
}
export function registerDefaultShaderRoundedWithBorderAndShadow(
  shManager: CoreShaderManager,
) {
  if (canUseShaders())
    shManager.registerShaderType(
      'roundedWithBorderWithShadow',
      isCanvas(shManager)
        ? lngr_canvas_shaders.RoundedWithBorderAndShadow
        : lngr_webgl_shaders.RoundedWithBorderAndShadow,
    );
}
export function registerDefaultShaderHolePunch(shManager: CoreShaderManager) {
  if (canUseShaders())
    shManager.registerShaderType(
      'holePunch',
      isCanvas(shManager)
        ? lngr_canvas_shaders.HolePunch
        : lngr_webgl_shaders.HolePunch,
    );
}
export function registerDefaultShaderRadialGradient(
  shManager: CoreShaderManager,
) {
  if (canUseShaders())
    shManager.registerShaderType(
      'radialGradient',
      isCanvas(shManager)
        ? lngr_canvas_shaders.RadialGradient
        : lngr_webgl_shaders.RadialGradient,
    );
}
export function registerDefaultShaderLinearGradient(
  shManager: CoreShaderManager,
) {
  if (canUseShaders())
    shManager.registerShaderType(
      'linearGradient',
      isCanvas(shManager)
        ? lngr_canvas_shaders.LinearGradient
        : lngr_webgl_shaders.LinearGradient,
    );
}

export function registerDefaultShaders(shManager: CoreShaderManager) {
  if (canUseShaders()) {
    registerDefaultShaderRounded(shManager);
    registerDefaultShaderShadow(shManager);
    registerDefaultShaderRoundedWithBorder(shManager);
    registerDefaultShaderRoundedWithShadow(shManager);
    registerDefaultShaderRoundedWithBorderAndShadow(shManager);
    registerDefaultShaderHolePunch(shManager);
    registerDefaultShaderRadialGradient(shManager);
    registerDefaultShaderLinearGradient(shManager);
  }
}
