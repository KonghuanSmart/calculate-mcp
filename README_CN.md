# calculate-mcp

[English](README.md) | [简体中文](README_CN.md)

[![npm version](https://img.shields.io/npm/v/calculate-mcp.svg)](https://www.npmjs.com/package/calculate-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)
[![Model Context Protocol](https://img.shields.io/badge/MCP-Ready-orange.svg)](https://modelcontextprotocol.io)

一个全面、高性能的 [Model Context Protocol (MCP)](https://modelcontextprotocol.io) 服务器。专为大语言模型（LLM）设计，提供高精度数值计算、底层二进制数据操作、IEEE 754 浮点数解析、密码学/数论运算、数据编解码，以及**独创的链式批处理引擎 (`batch_calc`)**，旨在彻底消除多步骤计算时的多轮往返通信开销。

---

## 🌟 核心亮点

- ⚡ **29 个专业运算工具**：全面覆盖任意精度整数进制转换、位逻辑运算、字节序转换、IEEE 754 浮点布局拆解、大数模运算、哈希/CRC校验、统计学与三角函数。
- 🔗 **零往返通信链式执行 (`batch_calc`)**：支持在单次工具调用中按序执行多个步骤，并通过 `{"$step": 0, "field": "resultHex"}` 引用前置步骤的结果，显著降低 LLM 通信延迟和 Token 消耗。
- 🔢 **任意精度与原生位宽**：底层完全基于原生 `BigInt` 实现——计算 64 位、128 位及超大整数时绝无精度损失，提供完整的 8/16/32/64 位有符号与无符号补码展开。
- 🛡️ **轻量纯净、零多余依赖**：纯 TypeScript 编写，仅依赖 Node.js 原生标准库与 Zod，无任何复杂 C++ 原生绑定，安全稳固。

---

## 📦 安装与客户端配置

### 1. Claude Desktop / Cursor / Cline / Pi

在客户端的 MCP 配置文件中（如 `claude_desktop_config.json` 或 `mcp.json`）添加如下配置：

#### 使用 `npx` 直接运行（推荐，免手动克隆与安装）：
```json
{
  "mcpServers": {
    "calculate-mcp": {
      "command": "npx",
      "args": ["-y", "calculate-mcp"]
    }
  }
}
```

#### 使用本地源码运行：
```json
{
  "mcpServers": {
    "calculate-mcp": {
      "command": "node",
      "args": ["/绝对路径/calculate-mcp/build/index.js"]
    }
  }
}
```

---

## 🛠️ 工具清单（共 29 个工具）

### 1. 流水线批处理工具（1 个）
| 工具名 | 说明 |
| :--- | :--- |
| `batch_calc` | 在单次调用中按序执行多个步骤。后续步骤可使用 `{"$step": 序号, "field": "字段名"}` 动态引用前序结果。 |

### 2. 数制转换与二进制操作（6 个）
| 工具名 | 说明 |
| :--- | :--- |
| `int_convert` | 任意精度整数转换：Hex、Dec、Bin、Oct、8/16/32/64 位有符号/无符号补码、小端序 Hex 及 ASCII，支持批量输入。 |
| `bitwise` | 位逻辑运算：支持 `and`, `or`, `xor`, `not`, `shl`, `shr`(逻辑右移), `sar`(算术右移), `rol`(循环左移), `ror`(循环右移)；支持 8/16/32/64 位宽。 |
| `endian_swap` | 字节序翻转：在数字、十六进制数值或任意长度字节数据流之间进行大端序（BE）与小端序（LE）互转。 |
| `ieee754_convert` | IEEE 754 浮点二进制布局深度拆解：解析单精度（Float32）与双精度（Float64）的符号位、指数、尾数及数值分类。 |
| `crypto_calc` | 密码学与数论基础运算：哈希（`md5`, `sha1`, `sha256`）、校验和（`crc32`, `crc16-ccitt`, `crc16-modbus`）及大数模运算（快速模幂 `mod_pow`、模逆元 `mod_inverse`、最大公约数 `gcd`）。 |
| `data_codec` | 常用数据编解码：Base64 编解码（标准及 URL-safe）、Hex 与 UTF-8 文本互转、URL 编解码。 |

### 3. 基础算术与取整（9 个）
| 工具名 | 说明 |
| :--- | :--- |
| `add` | 两数相加。 |
| `subtract` | 两数相减。 |
| `multiply` | 两数相乘。 |
| `division` | 两数相除。 |
| `sum` | 数组累加求和。 |
| `modulo` | 取模（求除法余数）。 |
| `floor` | 向下取整。 |
| `ceiling` | 向上取整。 |
| `round` | 四舍五入到最近整数。 |

### 4. 统计分析（5 个）
| 工具名 | 说明 |
| :--- | :--- |
| `mean` | 计算算术平均值。 |
| `median` | 计算中位数。 |
| `mode` | 计算众数（出现频次最高的数值）。 |
| `min` | 获取数组中的最小值。 |
| `max` | 获取数组中的最大值。 |

### 5. 三角函数与角度转换（8 个）
| 工具名 | 说明 |
| :--- | :--- |
| `sin`, `cos`, `tan` | 正弦、余弦、正切（弧度制）。 |
| `arcsin`, `arccos`, `arctan` | 反三角函数（弧度制）。 |
| `degreesToRadians` | 角度转弧度。 |
| `radiansToDegrees` | 弧度转角度。 |

---

## 💡 实战示例

### 示例 1：多步骤链式复合运算 (`batch_calc`)
在单次对话中完成“数据包头解码 ➔ 小端转大端 ➔ 掩码异或 ➔ 计算 CRC 校验和”：

```json
{
  "steps": [
    { "op": "data_codec", "args": { "action": "from_base64", "input": "c2VjcmV0", "format": "hex" } },
    { "op": "endian_swap", "args": { "value": "0x78563412", "widthBytes": 4 } },
    { "op": "bitwise", "args": { "operation": "xor", "a": { "$step": 1, "field": "bigEndianHex" }, "b": "0xDEADBEEF", "bitWidth": 32 } },
    { "op": "crypto_calc", "args": { "action": "crc32", "data": { "$step": 0, "field": "decoded" }, "inputFormat": "hex" } }
  ]
}
```

### 示例 2：数论与 RSA 模逆元求解
求方程 $d \equiv e^{-1} \pmod{\phi(n)}$，其中 $e=65537, \ \phi(n)=10000000000000000051$：

```json
{
  "action": "mod_inverse",
  "a": "65537",
  "modulus": "10000000000000000051"
}
```

### 示例 3：IEEE 754 浮点二进制机器码解析
将十六进制机器码 `0x3f800000` 还原解析为各字段：

```json
{
  "value": "0x3f800000",
  "precision": "float32"
}
```
**输出结果：**
```json
{
  "value": 1,
  "sign": "+",
  "rawExponentDec": 127,
  "biasedExponent": 0,
  "mantissaHex": "0x000000",
  "type": "normal"
}
```

---

## 💻 本地开发

```bash
# 克隆仓库
git clone https://github.com/<你的用户名>/calculate-mcp.git
cd calculate-mcp

# 安装依赖
npm install

# 编译 TypeScript 至 build/
npm run build

# 以 stdio 模式本地启动
npm start
```

---

## 📄 开源协议

[MIT License](LICENSE) © 2026
