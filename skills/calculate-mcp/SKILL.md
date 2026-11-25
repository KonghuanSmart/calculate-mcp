---
name: calculate-mcp
description: |
  精确计算与数据转换（calculate-mcp，29 个工具）。算术、统计、进制转换、位运算、大小端、IEEE 754、哈希/HMAC/AES/CRC、模运算、Base64/Hex/URL 编解码一律调它，不要心算。
  触发词：算一下、计算、求和、平均值、中位数、最大最小、三角函数、弧度角度、进制转换、转十六进制、转二进制、位运算、按位与、按位异或、移位、大小端、端序、IEEE754、浮点机器码、哈希、MD5、SHA256、HMAC、AES、CRC、Base64、Hex 编码、批量计算。
---

# calculate-mcp

29 个单动作工具 + 1 个 `batch_calc`。宿主里工具名可能带前缀（`calculate-mcp_add`），能力一样。

## 什么时候用

需要确定答案的数值或字节问题：算术统计、超大整数、浮点机器码、进制与位域、字节序、校验和、编解码、模运算。

不用它：符号推导（解方程、求导）、需要真实随机数的场景（AES 的 key/iv 要自己给）、把返回值当业务数据源（它不读文件、不联网、不存状态）。

## 任务 → 工具

| 做什么 | 工具 | 参数 |
| :--- | :--- | :--- |
| 加 / 减 / 乘 | `add` `subtract` `multiply` | `firstNumber`+`secondNumber`（`subtract` 用 `minuend`+`subtrahend`） |
| 除 / 取余 | `division` `modulo` | `numerator`+`denominator`（被除数在前） |
| 求和 平均 中位数 众数 最小 最大 | `sum` `mean` `median` `mode` `min` `max` | `numbers`；`mean`/`median` 另有 `precision` |
| 向下 / 向上 / 就近取整 | `floor` `ceiling` `round` | `number`；`round` 另有 `mode` |
| 三角、弧度角度互转 | `sin` `cos` `tan` `arcsin` `arccos` `arctan` `radiansToDegrees` `degreesToRadians` | `number`（**只收 number**） |
| 进制互转 | `int_convert` | `value` 或 `values`，可加 `compact` / `fields` |
| 位运算 | `bitwise` | `operation` `a` `b` `bitWidth` |
| 大小端翻转 | `endian_swap` | `value` `widthBytes` |
| 浮点 ↔ 机器码 | `ieee754_convert` | `value` `precision` |
| 摘要 / HMAC / AES / CRC / 模运算 | `crypto_calc` | `action` `data` `key` `iv` `algorithm` `crcVariant` `a` `b` `modulus` |
| Base64 / Hex / URL 编解码 | `data_codec` | `action` `input` `format` `urlSafe` |
| 多步串联 | `batch_calc` | `steps[]` |

参数名在不同工具里不一致，这几个最容易写错：

- `int_convert` 用 `value` / `values`，不是 `number`
- `data_codec` 用 `input`，不是 `data` 也不是 `value`
- `crypto_calc` 用 `data`，不是 `input`
- `bitwise` 用 `a` / `b`，`endian_swap` 用 `value`，两者别混

## 数值：唯一必须记住的规则

### 超过 2^53 的整数必须写成字符串

```json
{ "firstNumber": "9007199254740993", "secondNumber": "1" }
```

写成 JSON number 会直接报错，因为它在解析阶段就已经被舍入：

```
Unsafe integer input: 9007199254740992 exceeds Number.MAX_SAFE_INTEGER (9007199254740991) and may already be rounded; pass the intended value as a string (e.g. "9007199254740993")
```

看到这条说明值已经变了，必须改传字符串，不要改数字最后一位。

### 各工具接受的字符串写法

| 工具族 | 接受 | 不接受 |
| :--- | :--- | :--- |
| 算术、统计、取整 | 十进制、`0x`、负数 `-0x10`、分数 `"3/4"`、指数 `"1e3"` | `0b` / `0o` |
| `int_convert` | 十进制、`0x` `0b` `0o`，后缀写法 `"1010b"` `"1010o"` `"1010h"` | 小数、分数 |
| `bitwise` 的 `a`/`b` | 十进制、`0x` | 其它进制 |
| `endian_swap` 的 `value` | `0x`、空格分隔 `"12 34 56 78"`、偶数长度纯 hex `"0102030405060708"`（8 字节） | 奇数长度数字串按十进制 |
| `ieee754_convert` 的 `value` | hex 机器字，长度必须 8（float32）或 16（float64）个字符 | 十进制字符串（`"3.5"` 报错，十进制要传 number） |
| `crypto_calc` 的 `a`/`b`/`modulus` | 任意长度十进制或 `0x` | — |

整数走 BigInt 精确路径；只要混进小数或指数，整条运算切到 IEEE 754 双精度，`add(0.1,0.2)` 就是 `0.30000000000000004`，不做补偿。

### 枚举字段全部宽容

大小写不敏感，`-`、`_`、空格等价（直接删掉，`"SH L"` 也读成 `shl`），归一化后回显。适用 `bitwise.operation`、`round.mode`、`crypto_calc.algorithm` / `action` / `crcVariant` / `inputFormat` / `keyFormat`、`data_codec.action` / `format`、`ieee754_convert.precision`、`$cast`。

所以 `"CCITT"`、`"TO_HEX"`、`"toBase64"`、`"FLOAT64"` 都能用。写错不会在 schema 被拒，而是工具内报错并给候选：

```
Unknown CRC16 variant "xmodem"; expected one of: ccitt, modbus
```

## 返回形状

**裸字符串**，直接当数字用：`add` `subtract` `multiply` `sum` `modulo` `floor` `ceiling` `round` `mean` `median` `min` `max` + 8 个三角/角度工具。

**JSON 对象**，要 `JSON.parse`：`bitwise`（`operandA`/`resultHex`/`resultDecSigned`/`resultDecUnsigned`）、`endian_swap`（`bigEndianHex`/`littleEndianHex`/`byteArray`）、`ieee754_convert`（`float32`/`float64` 两档，各含 `value`/`hex`/`type`）、`int_convert`、`crypto_calc`、`data_codec`。

`division` 单独说：`{value, quotient?, remainder?}`。整数操作数才有后两项；能整除时 `value` 与 `quotient` 相同且精确，除不尽时 `value` 是双精度近似。

**JSON 数组**：`mode`（如 `["1","2.5"]`）、`int_convert` 传 `values` 时、`batch_calc`。

`hex` 类字段都带 `0x` 前缀，喂给别的工具时不用手工去掉，`0x` 是被接受的。

## 多步串联：batch_calc

步骤是 `{"op": ..., "args": {...}}`，`args` 这一层不能省，`op` 是另外 28 个工具名之一。

三种引用写法：

```json
{ "steps": [
  { "op": "add", "args": { "firstNumber": "0x7FFE0000", "secondNumber": "0x1A2F0" } },
  { "op": "int_convert", "args": { "value": { "$step": 0 }, "fields": ["hex", "decimal"] } },
  { "op": "bitwise", "args": { "operation": "and", "a": { "$step": 1, "field": "decimal", "$cast": "bigint" }, "b": "0xFFFF", "bitWidth": 32 } }
] }
```

- `{"$step": 0}` —— 取上一步整个结果
- `{"$step": 0, "field": "decimal"}` —— 取对象里的字段，引用不存在的字段报 `Step 0 result has no field "xxx"`
- `$cast` 取 `number` / `bigint` / `string`，数字文本转 number 时超安全整数会被拦，精确计算要 `bigint` 或不加 cast

自动转型：字符串形式的数字会自动转成下个工具要的类型，`$cast` 只在需要强制时用。

失败语义：某步业务失败记为 `{"status":"error","error":"..."}`，依赖它的后续步骤 `{"status":"skipped","reason":"depends on step N which is error"}`，其余步骤照常执行。但 `$step` 指向未来步骤、或 `op` 非法，会中止整个调用。

`bitwise` 的移位次数对位宽取模：32 位下移 32 次等于没动、33 次等于移 1 次；操作数先按 `2^bitWidth` 掩码。

## crypto_calc

| action | 必填 | 可选 | 返回 |
| :--- | :--- | :--- | :--- |
| `hash` | `data` | `algorithm`（默认 md5）、`inputFormat` | `{algorithm, input, hex, base64}` |
| `hmac` | `data`、`key` | `algorithm`、`inputFormat` | `{algorithm, key, input, hex, base64}` |
| `aes_encrypt` | `data`、`key`、`iv` | `inputFormat`、`keyFormat` | `{algorithm, keyBits, ciphertextHex, ciphertextBase64, length}` |
| `aes_decrypt` | `data`、`key`、`iv` | `inputFormat`、`keyFormat` | `{algorithm, keyBits, hex, length, plaintext?}` |
| `crc32` | `data` | `inputFormat` | `{checksumHex, checksumDec}` |
| `crc16` | `data` | `crcVariant`（ccitt / modbus，默认 modbus）、`inputFormat` | `{variant, checksumHex, checksumDec}` |
| `mod_pow` | `a`、`b`、`modulus` | — | `{base, exponent, modulus, resultDec, resultHex}` |
| `mod_inverse` | `a`、`modulus` | — | `{input, modulus, inverseDec, inverseHex}` |
| `gcd` | `a`、`b` | — | `{gcdDec, gcdHex}` |

- `algorithm` 只有 `md5` `sha1` `sha256` `sha384` `sha512`，不支持 SHA-3 / BLAKE
- AES key 必须 16/24/32 字节（`keyFormat: "hex"` 时算解码后字节数），`iv` 固定 16 字节，PKCS#7 填充
- `inputFormat: "hex"` 时 `data` 是偶数个 hex 字符，可带 `0x`
- 三个 `mod_*` 走 BigInt，参数任意长度

## data_codec

| action | 用 format | 返回 |
| :--- | :--- | :--- |
| `to_base64` | 用，决定输入按文本还是 hex | `{base64}` |
| `from_base64` | 不用 | `{hex, length, hexFormatted?, bytes?, decoded?}` |
| `to_hex` | 不用 | `{hex, hexFormatted, length}` |
| `from_hex` | 不用 | `{hex, length, hexFormatted?, bytes?, text?}` |
| `url_encode` | 不用 | `{encoded}` |
| `url_decode` | 不用 | `{decoded}` |

`hexFormatted` 和 `bytes` 只在负载 ≤ 64 字节时出现；`decoded`/`text` 只在字节构成可打印 UTF-8 时出现，二进制负载读 `hex`。`urlSafe` 只影响 `to_base64`（`-`/`_` 字母表、去 `=`），`from_base64` 两种都能解。

## int_convert

默认输出很全：`input` `decimal` `hex` `hexUpper` `binary` `binaryFormatted` `octal` `ascii?` `twosComplementHex?`（负数）`bitWidths.bit8|16|32|64`（各含 `unsigned` `signed` `hex`，16 位以上还有 `littleEndianHex`）。

只要几项时裁剪，避免大段输出：

```json
{ "value": 42, "compact": true }
```

给 `input` `decimal` `hex` `binary`（负数再多一个 `twosComplementHex`）。或者精确指定：

```json
{ "value": "0x401000", "fields": ["decimal", "bitWidths.bit32.hex"] }
```

```json
{"decimal":"4198400","bitWidths":{"bit32":{"hex":"0x00401000"}}}
```

`fields` 支持点号路径，优先于 `compact`；字段名写错会列出全部可用字段。

## 两个最小例子

**基址加偏移再取低 16 位**（一次调用，中间值不进上下文）：

```json
{ "steps": [
  { "op": "add", "args": { "firstNumber": "0x7FFE0000", "secondNumber": "0x1A2F0" } },
  { "op": "bitwise", "args": { "operation": "and", "a": { "$step": 0 }, "b": "0xFFFF", "bitWidth": 32 } }
] }
```

```json
[{...},{ "operation":"and", "bitWidth":32, "operandA":"2147459824", "operandB":"65535", "resultHex":"0x0000a2f0", "resultDecUnsigned":"41712" }]
```

## 高频报错

| 报错 | 改法 |
| :--- | :--- |
| `Unsafe integer input: ...` | 大整数改成字符串 |
| `Invalid numeric input: "0b1010"` | 算术类不认 `0b`/`0o`，换 `0x` 或十进制；二进制只在 `int_convert` 可用 |
| `Expected number, received string at number` | 三角函数只收 number，去掉引号 |
| `Unknown operation "nand"; expected one of: ...` | 用列出的九个之一 |
| `Operation "shl" requires a second operand` | 补 `b`，只有 `not` 可省 |
| `Division by zero: the denominator must not be zero` | 不会返回 Infinity/NaN，先判空 |
| `Invalid AES key length: N bytes; expected 16, 24, or 32` | 核对 `keyFormat` 与密钥长度 |
| `Step 0 result has no field "resultHex"` | 该工具没有这个字段，`add` 只给数字文本，`bitwise` 才有 `resultHex` |
| `Step 0: "$step" cannot be used because there is no earlier step to reference` | 只能引用更早的步骤，这类错误会中止整批 |
| `Array must contain at least 1 element(s) at numbers` | `numbers` 空数组，schema 阶段就拒 |
