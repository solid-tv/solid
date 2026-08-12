// The real @solidjs/router ships untranspiled .jsx compiled against a
// different solid moduleName, which vitest can't load. Nothing under test
// needs router behaviour — only the props KeepAliveRoute hands to <Route>.
export const Route = (props: unknown) => props;
