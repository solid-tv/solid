export const isDev = !!(import.meta.env && import.meta.env.DEV);

/** Whether element shaders are enabled */
export const SHADERS_ENABLED =
  typeof SOLIDTV_DISABLE_SHADERS === 'undefined' ||
  SOLIDTV_DISABLE_SHADERS !== true;
