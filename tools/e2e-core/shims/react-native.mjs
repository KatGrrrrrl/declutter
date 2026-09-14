// Just enough of react-native for src/lib to run under Node as if on the web.
export const Platform = { OS: 'web', select: (o) => (o.web ?? o.default) };
export default { Platform };
