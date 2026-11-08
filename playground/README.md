# playground

`playground.html` 的运行时。页面是静态的；第一次执行动作时，`playground.js` 从 CDN 取
Pyodide（CPython 的 WebAssembly 构建），再把所选**通道**的 Python 模块写进虚拟文件系统：

1. 参考编译器编译源码；
2. LVM 执行，或 `lomelf` 产出原生 ELF/PE；
3. 输出、产物与退出码回到页面。

**没有任何内容上传。** 编译与执行都在浏览器标签页里。

## 两个通道

| 通道 | 内容 | 目录 |
|---|---|---|
| **Beta (0.1.5.2.beta.2)** | 最新 `main` 分支的参考编译器与库，默认 | `beta/` |
| **Stable (0.1.5.1)** | `v0.1.5.1` 标签上的参考编译器与库 | `stable/` |

通道选中后**从自己的目录**取 `manifest.json` 与全部资产，编译器模块、`loment/lib` 与
`lompi/store` 不跨通道共用。切换通道会保存当前源码并带 `?channel=` 重新加载页面。

## 动作由 Loment 的能力决定

| 动作 | 做什么 | 对应的 Loment 面 |
|---|---|---|
| Run | 编译并用 LVM 执行 | `lvm.run_source` |
| Check | 只做装载与检查，不执行 | `lomentc.check` |
| Build | 产出 ELF 或 PE，可下载 | `lomelf.compile_ll` / `compile_pe` |
| LLVM IR | 打印文本 IR | `lomentc.emit_llvm` |
| AST | 打印解析后的模块：常量、结构体、枚举、能力、函数 | `Module` 节点 |
| Potato | 打印形式对象 JSON | `lomentc.emit_potato` |
| Machine code | 打印 ELF `.text` 的十六进制清单 | `lomelf` 产物 |
| Wasm | 尚未实现，显示 0.1.5.2 的计划 | wasm32 后端（docs/313 / #1496） |

Loment 没有 MIR、HIR 与文本汇编，所以页面不提供这三个名字；AST/Potato/机器码是它
真实的三个可观察面。`Edition` 选 Tur 版次（2026.3 / 2026.2 / 2026.1），`Target` 选
`Build` 与 `Machine code` 的目标（ELF / PE）。

## 目录

| 路径 | 内容 |
|---|---|
| `playground.js` | 编辑器、高亮、Pyodide 引导、动作分发与产物下载 |
| `beta/` `stable/` | 两个通道各自的 `py/` 与 `manifest.json` |
| `beta/py/tools/` | 参考编译器、`lomelf`、`lvm`、`pg_runner.py` 及其依赖 |
| `beta/py/loment/lib/` | 工具链自带的核心库（`num`、`mem`、`proc`、`json` …） |
| `beta/py/lompi/store/` | 随包发布的标准库与 host 库 |
| `beta/py/loment/lspe/` | 编译器导入的 LSPE 包 |
| `beta/py/helpers.lomt` | 教材 by-example 共用的 `out` / `dec` / `nl` |
| `make_manifest.py` | 生成两个通道的清单；**新增/删除文件后重跑它** |

## 刷新一个通道

来自开发仓，**逐字节复制，不在这里改**：

```sh
R=<loment checkout at the channel's ref>
C=playground/beta        # 或 playground/stable
MODS="lomc.py lomelf.py lomentc.py lvm.py potato.py potato_from.py lomt_from.py loment_comefor.py loment_diag.py loment_interp.py"
for m in $MODS; do cp "$R/tools/$m" "$C/py/tools/$m"; done
rm -rf "$C/py/loment/lib" "$C/py/lompi/store"
cp -a "$R/loment/lib" "$C/py/loment/lib"
cp -a "$R/lompi/store" "$C/py/lompi/store"
cp -a "$R/loment/lspe" "$C/py/loment/lspe"
cp playground/beta/py/tools/pg_runner.py "$C/py/tools/pg_runner.py"
cp playground/beta/py/helpers.lomt "$C/py/helpers.lomt"
python playground/make_manifest.py
```

`pg_runner.py` 与 `helpers.lomt` 是站点自己的文件，两个通道用同一份。Beta 用最新
`main` 的检出，Stable 用 `v0.1.5.1` 的检出。

更新后跑一次页面：默认示例、一个 `use num` 的程序、一个带 `helpers.lomt` 的书内示例，
以及 Build 的 ELF 与 PE 下载都通过才算过。

## 边界

- 程序用 `fn main()` 或 `fn _start()`；只有 `main` 时 `pg_runner` 在**内存里**补一个
  `_start`，不改源码。
- 没有标准输入、文件与套接字；`lvm.py` 只认识它自己合成的那一个文件描述符。
- 执行受 LVM 的步数上限约束，死循环会被截断并报告。
- 诊断是编译器自己的中文消息；页面不翻译它们。
- Pyodide 版本固定在 `playground.js` 的 `CDN` 常量里；升级前先在页面上跑一遍全部动作。
