import "server-only";
// Node 22+ loads Next's existing native dependency without bundling its binaries.
const nativeRequire = process.getBuiltinModule("module").createRequire(
  process.getBuiltinModule("fs").realpathSync(process.cwd() + "/node_modules/next/package.json"),
);
export const serverSharp = nativeRequire("sharp") as ReturnType<typeof import("next/dist/server/image-optimizer").getSharp>;
