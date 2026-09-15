---
name: calculate-mcp
description: |
  精确计算与数据转换技能。当涉及任何数学运算、统计计算、大数、浮点数、进制转换、计算机底层位运算、端序转换、IEEE-754 浮点解析、数据编解码（Base64/Hex/URL）以及哈希/摘要计算时，必须使用此技能。
  Chinese triggers include: 计算、算一下、加减乘除、求和、平均值、中位数、极值、三角函数、弧度角度转换、进制转换、转16进制、转二进制、转八进制、十进制转Hex、位运算、与或非异或、按位与、按位异或、移位、大小端转换、端序变换、Endian swap、IEEE754、单双精度浮点分解、哈希计算、算MD5、算SHA1、算SHA256、Base64编码、Base64解码、Hex编码、Hex转字符串、批量计算。
  Strict rule: 严禁 LLM 在上下文中自行心算推演复杂算式、位运算、端序转换、Base64 编解码或哈希计算，必须强制调用 calculate-mcp 提供的工具以确保 100% 准确性。
---

# 精确计算与数据转换技能 (calculate-mcp)

## 核心原则

大语言模型在心算浮点、大数乘除、位运算溢出、Base64 填充和密码学哈希时极易产生幻觉与精度偏差。
**只要任务包含确定性数值计算、底层数据转换或哈希编码，严禁心算，必须调用 `calculate-mcp` 工具。**

---

## 常用工具映射表

> **命名空间说明**：在 Pi 等多服务 Agent 环境中，工具名前带服务名前缀（如 `calculate-mcp_add`、`calculate-mcp_bitwise`）；在 Claude Desktop、Cursor 等单服务或原生 MCP 环境中，工具名即为 `add`、`bitwise`、`batch_calc` 等。二者映射底层相同能力。

### 1. 基础数学与统计

| 场景 | 工具名称 | 关键参数与说明 |
| :--- | :--- | :--- |
| 两数相加 | `calculate-mcp_add` | `a`, `b` |
| 两数相减 | `calculate-mcp_subtract` | `a`, `b` (`a - b`) |
| 两数相乘 | `calculate-mcp_multiply` | `a`, `b` |
| 两数相除 | `calculate-mcp_division` | `a`, `b` (`a / b`) |
| 多数值求和 | `calculate-mcp_sum` | `numbers: number[]` |
| 取模/余数 | `calculate-mcp_modulo` | `dividend`, `divisor` |
| 取整与舍入 | `calculate-mcp_floor` / `calculate-mcp_ceiling` / `calculate-mcp_round` | `value` |
| 统计指标 | `calculate-mcp_mean` / `calculate-mcp_median` / `calculate-mcp_mode` | `numbers: number[]`（均值/中位数/众数） |
| 极值查找 | `calculate-mcp_min` / `calculate-mcp_max` | `numbers: number[]` |

### 2. 几何与三角函数

| 场景 | 工具名称 | 参数 |
| :--- | :--- | :--- |
| 正弦 / 余弦 / 正切 | `calculate-mcp_sin` / `calculate-mcp_cos` / `calculate-mcp_tan` | `radians: number` |
| 反三角函数 | `calculate-mcp_arcsin` / `calculate-mcp_arccos` / `calculate-mcp_arctan` | `value: number` |
| 弧度角度互转 | `calculate-mcp_radiansToDegrees` / `calculate-mcp_degreesToRadians` | `value: number` |

### 3. 逆向工程与底层数据处理（重点）

| 场景 | 工具名称 | 关键参数示例与说明 |
| :--- | :--- | :--- |
| **进制互转** | `calculate-mcp_int_convert` | `value` (支持字符串如 `"0x1A"`, `"1010b"`, 或数字)，输出 Hex/Dec/Bin/Oct |
| **位运算** | `calculate-mcp_bitwise` | `operation`: `"AND" \| "OR" \| "XOR" \| "NOT" \| "SHL" \| "SHR"`, `a`, `b?`, `bit_width?` (8/16/32/64) |
| **大小端转换** | `calculate-mcp_endian_swap` | `value`: 十六进制字符串或数值, `width`: `2 \| 4 \| 8` (字节数) |
| **IEEE-754 浮点** | `calculate-mcp_ieee754_convert` | `value`: 浮点数或十六进制 Raw 内存表示，分解符号位、阶码和尾数 |
| **密码学哈希** | `calculate-mcp_crypto_calc` | `algorithm`: `"MD5" \| "SHA1" \| "SHA256" \| "SHA512"`, `data`: 目标文本或 Hex |
| **数据编解码** | `calculate-mcp_data_codec` | `operation`: `"encode" \| "decode"`, `type`: `"base64" \| "hex" \| "url"`, `data`: 输入数据 |
| **批量复杂计算** | `calculate-mcp_batch_calc` | `steps: Array<{ tool: string, args: object }>`，支持上一步输出管道传递 |

---

## 典型调用工作流

### 场景 A：逆向分析中的地址偏移与位掩码计算
1. 用户需求：“基址是 0x7FFE0000，偏移是 0x1A2F0，另外对齐到 0x1000 并做异或掩码 0x5A”
2. 严禁心算！立即调用：
   - 步骤 1：调用 `calculate-mcp_add` 计算 `a: 0x7FFE0000`, `b: 0x1A2F0`
   - 步骤 2：对结果调用 `calculate-mcp_bitwise` 执行 `operation: "XOR"`, `b: 0x5A`
   - 步骤 3：直接返回工具输出的绝对准确结果。

### 场景 B：校验和与数据解码
1. 用户需求：“帮我把这段 Base64 字符串解码，并算一下 SHA256”
2. 立即调用：
   - 步骤 1：调用 `calculate-mcp_data_codec` (`operation: "decode"`, `type: "base64"`, `data: "..."`)
   - 步骤 2：调用 `calculate-mcp_crypto_calc` (`algorithm: "SHA256"`, `data: 解码后的内容`)
3. 输出客观事实，避免人工手搓带来的 byte 差错。

### 场景 C：批量执行多步运算
使用 `calculate-mcp_batch_calc` 将多个运算一步提交，降低网络与上下文往返开销。
