# playground

`playground.html` 的运行时。页面本身是静态的；第一次点「运行」时，`playground.js`
从 CDN 取 Pyodide（CPython 的 WebAssembly 构建），再把这里的 Python 模块写进虚拟文件系统：

1. 参考编译器把源码编成 LLVM IR；
2. LVM 解释 IR 并执行；
3. 标准输出、诊断与退出码回到页面。

**没有任何内容上传。** 编译与执行都在浏览器标签页里。

## 目录

| 路径 | 内容 |
|---|---|
| `playground.js` | 编辑器、高亮、Pyodide 引导、运行与输出 |
| `py/tools/` | 参考编译器与其依赖（`lomentc.py`、`lomelf.py`、`lvm.py` 等） |
| `py/loment/lib/` | 工具链自带的核心库（`num`、`mem`、`proc`、`json` …） |
| `py/lompi/store/` | 随包发布的标准库与 host 库（156 个 `.lomt`） |
| `py/loment/lspe/` | 编译器导入的 LSPE 包 |
| `py/helpers.lomt` | 教材 by-example 共用的 `out` / `dec` / `nl`；写进虚拟盘，书里的示例可原样粘贴 |
| `manifest.json` | 190 个文件的清单；`make_manifest.py` 生成。**新增/删除文件后重跑它** |

## 这些副本从哪里来

来自开发仓的 `tools/`、`loment/lib/`、`loment/lspe/` 与 `lompi/store/`，
**逐字节复制，不在这里改**。需要更新时：

```sh
R=<loment checkout>
cp "$R"/tools/{lomc,lomelf,lomentc,lvm,potato,potato_from,loment_comefor,loment_diag,loment_interp}.py playground/py/tools/
rm -rf playground/py/loment/lib playground/py/lompi/store
cp -a "$R"/loment/lib playground/py/loment/lib
cp -a "$R"/lompi/store playground/py/lompi/store
cp "$R"/loment/lspe/*.py playground/py/loment/lspe/
python playground/make_manifest.py
```

清单是**整个目录**的映射，所以编译器新增一个依赖模块、标准库新增一个包，都不需要改
`playground.js`；重跑 `make_manifest.py` 即可。更新后跑一次页面：默认示例、一个
`use num` 的程序、一个带 `helpers.lomt` 的书内示例都通过才算过。

## 边界

- 程序用 `fn main()` 或 `fn _start()`。页面会给只有 `main` 的源补一个 `_start` 垫片，
  补丁只存在于浏览器里，不改源码。
- 没有标准输入、文件与套接字；`lvm.py` 只认识它自己合成的那一个文件描述符。
- 执行受 LVM 的步数上限约束，死循环会被截断并报告。
- 诊断是编译器自己的中文消息；页面不翻译它们。
- Pyodide 版本固定在 `playground.js` 的 `CDN` 常量里；升级前先在页面上跑一遍四个示例。
