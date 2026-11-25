# calculate-mcp

一个 Model Context Protocol 服务器，专门接手那些不该让语言模型「心里估一下」的计算：任意精度整数运算、统计量、指定位宽的位运算与移位、字节序翻转、IEEE 754 拆解、摘要与校验和、模运算，以及 Base64 / Hex / URL 编解码。

它通过 stdio 通信，对外提供 29 个工具。所有工具的回答只有两种形式——一个纯数字，或者一段 JSON——不会夹带解释性文字，调用方可以直接读取数值或解析结构。

## 为什么需要它：和心算、和计算器的区别

模型在心算 `0x7FFE0000 + 0x1A2F0`、`0.1 + 0.2` 这类式子时，给出的结果往往「看起来对」。桌面计算器则相反：它只吐一个数，把编程时真正要看的东西全都藏起来——32 位补码是多少、字节序反没反、符号位/指数位/尾数位各是什么。

`calculate-mcp` 面向的正是第二类问题，而且在计算器会漂移的地方保持精确：

- **整数不丢位**：`add` 传入 `"9007199254740993"` 和 `1`，得到 `9007199254740994`。这个数没有精确的 `double` 表示，JavaScript / Python 的浮点路径根本存不下。
- **位宽是参数，不是事后补**：`bitwise` 传 `bitWidth: 16`、`operation: "xor"`、`a: "0x1234"`、`b: "0xF00F"`，一次就能拿到 `resultHex: "0xe23b"`、`resultDecSigned: "-7621"`、`resultDecUnsigned: "57915"` 和完整二进制串。
- **字节是「看」出来的，不是重新编码的**：解码 Base64 / Hex 时，结果永远包含原始字节的 hex 和字节长度，只有恰好是可打印 UTF-8 才额外附上文本，二进制负载不会在字符集转换里被改坏。
- **多步串在服务端跑完**：`batch_calc` 按顺序执行多个步骤，后面的步骤能直接读前面结果的某个字段，中间值不需要回到模型上下文里再传一遍。
- **失败给的是错误文案，不是 `NaN`**：除零、未知位运算、AES 密钥长度不对，都会返回工具错误，并把可选值一并列出。

典型场景：逆向分析里的地址与偏移运算、位掩码与寄存器布局、协议的字节序与校验和、Base64 / Hex 数据搬运、浮点机器码排查、教学或验证用的 RSA 模运算、需要固定小数位的统计结果。

## 运行环境

- Node.js 18 或更高版本（服务是 ESM，依赖 `BigInt` 和 Node 自带的 `crypto`）。
- 任意能拉起 stdio 服务端的 MCP 客户端（Claude Desktop、Cursor、Pi 或基于 SDK 的宿主）。

## 安装与客户端配置

### 方式 A：通过 `npx` 直接跑

把下面这段写进客户端的 MCP 配置（Claude Desktop 是 `claude_desktop_config.json`，Cursor 是 `mcp.json`）：

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

不用克隆仓库，`npx` 首次启动时会拉取已发布的包。Windows 上有部分客户端不经过 shell 直接启动进程，如果报找不到 `npx`，把配置换成：

```json
{
  "mcpServers": {
    "calculate-mcp": {
      "command": "cmd",
      "args": ["/c", "npx", "-y", "calculate-mcp"]
    }
  }
}
```

### 方式 B：跑本地源码

```bash
git clone https://github.com/KonghuanSmart/calculate-mcp.git
cd calculate-mcp
npm install
npm run build
```

然后让客户端指向编译产物的绝对路径：

```json
{
  "mcpServers": {
    "calculate-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/calculate-mcp/build/index.js"]
    }
  }
}
```

Windows 下路径可以写成正斜杠（`"D:/tools/calculate-mcp/build/index.js"`），也可以写转义后的反斜杠。改完配置要重启客户端；服务启动后会在 stderr 打印 `MCP Server running in stdio mode`，随后阻塞等待 stdin。

## 一次调用长什么样

每个工具都接收一个 JSON 对象作为参数。成功时返回一个文本块，内容要么是数字（`"4198400"`），要么是 JSON（`{"hex":"0x401000", ...}`）——具体是哪种由工具决定，下面清单里逐个标注。

失败分两类，含义完全不同：

| 出错原因 | 调用方看到什么 |
| :--- | :--- |
| 参数不符合 schema（缺字段、类型不对、`numbers` 数组为空） | 协议层错误：`MCP error -32602: Input validation error: Invalid arguments for tool sin: Expected number, received string at number` |
| 参数结构没问题、但运算做不了（未知操作名、除数为零、AES 密钥长度不对） | 工具结果带 `isError: true`，消息即正文，例如 `Division by zero: the denominator must not be zero` |

## 工具清单（29 个）

### 1. 批处理（1 个）

| 工具 | 作用 | 参数 | 返回 |
| :--- | :--- | :--- | :--- |
| `batch_calc` | 一次调用执行多个运算，步骤间可引用前一步结果 | `steps`：数组（至少 1 项），每项 `{ "op": <工具名>, "args": { ... } }`；`op` 取 28 个非批处理工具名之一 | JSON 数组，元素为 `{step, op, status, result \| error \| reason}` |

引用、转型、失败语义见 [batch_calc 详解](#batch_calc-详解)。

### 2. 算术与取整（9 个）

| 工具 | 作用 | 参数 | 返回 |
| :--- | :--- | :--- | :--- |
| `add` | `firstNumber + secondNumber` | `firstNumber`、`secondNumber`：number 或 string（均必填） | 数字文本 |
| `subtract` | `minuend - subtrahend` | `minuend`、`subtrahend`：number 或 string（均必填） | 数字文本 |
| `multiply` | `firstNumber × secondNumber` | `firstNumber`、`secondNumber`：number 或 string（均必填） | 数字文本 |
| `division` | `numerator ÷ denominator`；两个操作数都是整数且能整除时给精确整数，否则按 IEEE 754 双精度相除，整数操作数另给精确的整除商和余数 | `numerator`、`denominator`：number 或 string（均必填） | JSON `{value, quotient?, remainder?}` |
| `sum` | 列表求和 | `numbers`：number 或 string 组成的数组（至少 1 项） | 数字文本 |
| `modulo` | 取余，向零截断，符号跟随被除数 | `numerator`、`denominator`：number 或 string（均必填） | 数字文本 |
| `floor` | 向下取整 | `number`：number 或 string | 数字文本 |
| `ceiling` | 向上取整 | `number`：number 或 string | 数字文本 |
| `round` | 就近取整，可选平局规则 | `number`：number 或 string；`mode`：string，默认 `"js-round"`，可选 `js-round`、`half-up`、`half-even`、`truncate` | 数字文本 |

`division` 只有两个操作数都能解析成整数时才附带 `quotient` 和 `remainder`。能整除时 `value` 就是精确整数，与 `quotient` 完全一致：`"9007199254740993" / 3` 返回 `value: "3002399751580331"`、`quotient: "3002399751580331"`、`remainder: "0"`。除不尽时 `value` 是双精度近似值，精确答案在 `quotient` 和 `remainder` 里：`1 / 3` 返回 `value: "0.3333333333333333"`、`quotient: "0"`、`remainder: "1"`。

`round` 的平局规则：`js-round` 让 `x.5` 朝 `+Infinity` 靠（等价 `Math.round`，所以 `2.5 → 3`、`-2.5 → -2`），`half-up` 远离零，`half-even` 是银行家舍入（`2.5 → 2`、`3.5 → 4`），`truncate` 直接截断（`-2.7 → -2`）。

### 3. 统计（5 个）

| 工具 | 作用 | 参数 | 返回 |
| :--- | :--- | :--- | :--- |
| `mean` | 算术平均值 | `numbers`：数组（至少 1 项）；`precision`：0–100 的整数（可选，小数点后最多几位） | 数字文本 |
| `median` | 中位数（偶数个取中间两个的均值） | `numbers`：数组（至少 1 项）；`precision`：0–100 的整数（可选） | 数字文本 |
| `mode` | 出现次数最多的值 | `numbers`：数组（至少 1 项） | 数字字符串组成的 JSON 数组 |
| `min` | 最小值 | `numbers`：数组（至少 1 项） | 数字文本 |
| `max` | 最大值 | `numbers`：数组（至少 1 项） | 数字文本 |

`mode` 会把所有并列的值按首次出现顺序全部返回：`[1, 2, 2, 3, 3]` 得到 `["2", "3"]`。`precision` 只作用于 `mean` 和 `median`；结果是整数时即便设了 `precision` 也不会补小数点。

### 4. 三角函数与角度换算（8 个）

| 工具 | 作用 | 参数 | 返回 |
| :--- | :--- | :--- | :--- |
| `sin` / `cos` / `tan` | 弧度制正弦、余弦、正切 | `number`：number（必填，**只能是 number**） | 数字文本 |
| `arcsin` / `arccos` / `arctan` | 反函数，结果以弧度表示 | `number`：number（必填） | 数字文本 |
| `radiansToDegrees` | 弧度转角度 | `number`：number（必填） | 数字文本 |
| `degreesToRadians` | 角度转弧度 | `number`：number（必填） | 数字文本 |

这 8 个工具只吃 number，传字符串 `"1"` 会直接 schema 报错，这点与算术类工具不同。返回值就是 `Math.*` 的双精度结果，所以 `sin(3.141592653589793)` 是 `1.2246467991473532e-16` 而不是 `0`。

### 5. 整数、位域与字节（4 个）

| 工具 | 作用 | 参数 | 返回 |
| :--- | :--- | :--- | :--- |
| `int_convert` | 把一个整数展开成十进制、十六进制、二进制、八进制、8/16/32/64 位有符号与无符号视图、小端 hex 和 ASCII | `value`：string 或 number（单值）；`values`：string 或 number 数组（批量）；`compact`：boolean；`fields`：字符串数组，支持点号路径 | 单值返回 JSON 对象，多值返回 JSON 数组 |
| `bitwise` | `and`、`or`、`xor`、`not`、`shl`、`shr`、`sar`、`rol`、`ror`，位宽 8/16/32/64 | `operation`：string（必填）；`a`：string 或 number（必填）；`b`：string 或 number（移位次数或第二操作数）；`bitWidth`：8、16、32 或 64，默认 32 | JSON `{operation, bitWidth, operandA, operandB?, resultHex, resultDecSigned, resultDecUnsigned, resultBin}` |
| `endian_swap` | 反转数字、`0x` 十六进制值或字节流的字节序 | `value`：string 或 number（必填）；`widthBytes`：正整数（可选，省略时按值推断） | JSON `{input, byteCount, bigEndianHex, littleEndianHex, byteArray, reversedByteArray, hexFormatted}` |
| `ieee754_convert` | 浮点数与 IEEE 754 布局双向转换 | `value`：十进制浮点传 number（如 `3.14159`），hex 机器字传 string（如 `"0x3f800000"`，float32 必须 8 个 hex 字符、float64 必须 16 个）；`precision`：`"float32"`、`"float64"` 或 `"both"`（默认 `"both"`，大小写不敏感） | JSON `{input, float32?, float64?}`，内部字段见下文 |

几个容易踩的细节：

- **`int_convert` 的字段**。完整输出包含 `input`、`decimal`、`hex`、`hexUpper`、`binary`、`binaryFormatted`、`octal`、`ascii`（仅当值落在可打印 ASCII 范围）、`twosComplementHex`（仅负数）、以及 `bitWidths.bit8|bit16|bit32|bit64`，每档含 `unsigned`、`signed`、`hex`，16 位以上还有 `littleEndianHex`。64 位的 `unsigned` 和 `signed` 是十进制字符串，因为它们可能超过 `2^53`。`compact: true` 只保留 `input`、`decimal`、`hex`、`binary`，负数再加 `twosComplementHex`；`fields` 优先级高于 `compact`，接受 `["decimal", "bitWidths.bit32.hex"]` 这样的点号路径。
- **`bitwise` 会先掩码，移位次数会取模**。操作数先按 `2^bitWidth` 取模，所以 `bitWidth: 8` 下 `a: "0x1ff"` 等同于 `0xff`；移位次数对位宽取模，32 位下 `shl` 移位 32 次等于没动，移位 33 次等于移 1 次。`not` 只用一个操作数并忽略 `b`，其余操作缺 `b` 会报 `Operation "and" requires a second operand.`。结果里的有符号、无符号视图都是十进制字符串。
- **`endian_swap` 的入参形态**。可以是 `0x` 前缀字符串、空格分隔的字节流（`"12 34 56 78"`）、偶数长度的纯 hex 串（`"0102030405060708"` 就是 8 个字节）或 JS 数字。不满足「纯 hex 且偶数长度」的字符串按整数解析，所以 `"12345"` 是数字 12345，而 `"1234"` 是 2 个字节——偶数长度的十进制串想按数值处理请直接传 JSON number。`widthBytes` 会把值补齐或截断到指定长度，例如 `"0x1234"` 配 `widthBytes: 8` 得到 `bigEndianHex: "0x0000000000001234"`。
- **`ieee754_convert` 的输出结构**。每档精度给出 `value`（按该精度舍入后的数值，float32 的 `0.1` 是 `0.10000000149011612`）、`hex`、`binary`、`signBit`、`sign`、`rawExponentHex`、`rawExponentDec`、`biasedExponent`、`mantissaHex`、`mantissaFraction` 和 `type`（`normal`、`subnormal`、`zero`、`infinity`、`nan`）。字符串参数一律按十六进制机器字解释，绝不按十进制解析：`"10"` 会报错，因为它只有 2 个 hex 字符，而当前精度要求 8 个（float32）或 16 个（float64）——报错会直接写出期望的字符数，不会补零也不会截断。十进制数值必须用 JSON number 传，且 `precision` 会收窄可接受的长度，所以 `"0x400921fb54442d18"` 配 `precision: "float32"` 会失败。

### 6. 密码学与编解码（2 个）

| 工具 | 作用 | 参数 | 返回 |
| :--- | :--- | :--- | :--- |
| `crypto_calc` | 通过一个 `action` 开关提供摘要、HMAC、AES-CBC、CRC32/CRC16 和模运算 | `action`：`hash`、`hmac`、`aes_encrypt`、`aes_decrypt`、`crc32`、`crc16`、`mod_pow`、`mod_inverse`、`gcd`（必填），其余字段按 action 见下表 | JSON，按 action 不同 |
| `data_codec` | Base64、Hex、URL 编解码 | `action`：`to_base64`、`from_base64`、`to_hex`、`from_hex`、`url_encode`、`url_decode`（必填）；`input`：string（必填）；`format`：`text` 或 `hex`，默认 `text`；`urlSafe`：boolean，默认 false | JSON，按 action 不同 |

`crypto_calc` 完整参数表：

| `action` | 必填字段 | 可选字段 | 返回 |
| :--- | :--- | :--- | :--- |
| `hash` | `data` | `algorithm`（默认 `md5`，可选 `md5`、`sha1`、`sha256`、`sha384`、`sha512`）、`inputFormat`（`text` / `hex`，默认 `text`） | `{algorithm, input, hex, base64}` |
| `hmac` | `data`、`key` | `algorithm`、`inputFormat`（同时作用于 `data` 和 `key`） | `{algorithm: "hmac-sha256", key, input, hex, base64}` |
| `aes_encrypt` | `data`、`key`、`iv` | `inputFormat`（作用于 `data`）、`keyFormat`（`text` / `hex`，作用于 `key` 和 `iv`） | `{algorithm: "aes-128-cbc", keyBits, ciphertextHex, ciphertextBase64, length}` |
| `aes_decrypt` | `data`、`key`、`iv` | `inputFormat`、`keyFormat` | `{algorithm, keyBits, hex, length, plaintext?}` |
| `crc32` | `data` | `inputFormat` | `{checksumHex, checksumDec}` |
| `crc16` | `data` | `crcVariant`（`ccitt` 或 `modbus`，默认 `modbus`）、`inputFormat` | `{variant, checksumHex, checksumDec}` |
| `mod_pow` | `a`（底数）、`b`（指数）、`modulus` | — | `{base, exponent, modulus, resultDec, resultHex}` |
| `mod_inverse` | `a`、`modulus` | — | `{input, modulus, inverseDec, inverseHex}` |
| `gcd` | `a`、`b` | — | `{gcdDec, gcdHex}` |

AES 密钥必须是 16、24 或 32 字节（`keyFormat: "hex"` 时按解码后的字节数算），IV 必须 16 字节，填充为 PKCS#7。只有解密结果恰好是可打印 UTF-8 时才会出现 `plaintext`。三个模运算 action 用 `BigInt` 实现，接受任意长度的十进制或 `0x` 字符串，`"123456789012345678901234567890"` 这种量级没问题。

`data_codec` 完整参数表：

| `action` | 是否使用 `format` | 返回 |
| :--- | :--- | :--- |
| `to_base64` | 是，决定输入按文本还是 hex 字节处理 | `{base64}` |
| `from_base64` | 否，结果永远是原始字节视图 | `{hex, length, hexFormatted?, bytes?, decoded?}` |
| `to_hex` | 否 | `{hex, hexFormatted, length}` |
| `from_hex` | 否 | `{hex, length, hexFormatted?, bytes?, text?}` |
| `url_encode` | 否 | `{encoded}`（内部用 `encodeURIComponent`） |
| `url_decode` | 否 | `{decoded}` |

负载不超过 64 字节时才有 `hexFormatted` 和 `bytes`。只有每个字节都构成可打印 UTF-8 时才会出现 `decoded`（Base64）或 `text`（Hex）；除 Tab、LF、CR 之外的制表控制字符会使其被省略。`from_base64` 传 `format: "hex"` 时，返回值会额外把 `decoded` 设成 hex 字符串。

## 数值：什么时候传 number，什么时候必须传字符串

JSON 数字本身就是 IEEE 754 双精度，`9007199254740993` 这样的字面量在任何服务端读到时已经变成 `9007199254740992`。因此这些工具同时接受 number 和 string，并按值本身选择计算路径：

| 输入 | 计算路径 | 例子 |
| :--- | :--- | :--- |
| 整数字符串：`"9007199254740993"`、`"0x401000"`、`"-42"`；`"0b1010"` / `"0o77"` 仅限进制转换类工具 | `BigInt`，任意长度精确 | `add("9007199254740993", "1")` → `9007199254740994` |
| 分数字符串：`"3/4"`、`"1 / 3"` | 先做除法，再按双精度 | `add("3/4", "1/4")` → `1` |
| 指数字符串：`"1e3"` | 双精度 | `add("1e3", 1)` → `1001` |
| 任意 JS number，或含 `.` / `e` 的字符串 | IEEE 754 双精度，不做补偿 | `add(0.1, 0.2)` → `0.30000000000000004` |

由此得到几条规则：

1. **超过 `Number.MAX_SAFE_INTEGER` 的整数必须写成字符串。** 传 number 不会被悄悄舍入，而是直接拒绝：`add` 传 `firstNumber: 9007199254740993` 会返回 `Unsafe integer input: 9007199254740992 exceeds Number.MAX_SAFE_INTEGER (9007199254740991) and may already be rounded; pass the intended value as a string (e.g. "9007199254740993")`。消息里出现 `...992`，是因为传进来的值已经变成这个数了。
2. **整数操作数走精确路径。** `add`、`subtract`、`multiply`、`sum`、`modulo`、`mean`、`median`、`floor`、`ceiling`、`round`、`min`、`max` 对整型输入使用 `BigInt`。只要混入一个小数或指数值，整条运算就切到双精度。
3. **进制前缀按工具族区分。** 算术与取整类接受十进制、`0x` 十六进制（可带符号，如 `"-0x10"`）和分数，但不接受 `0b` / `0o`，传了会报 `Invalid numeric input: "0b1010" (expected a decimal, 0x hex integer, fraction a/b, or signed value)`。`int_convert` 相反：`0x`、`0b`、`0o`、十进制、负数都收，后缀写法 `"1010b"`（二进制）、`"1010o"`（八进制）、`"1010h"`（十六进制）也可以。
4. **只有 8 个三角函数工具强制要求 number。** 算术、统计、进制类其余工具都是 `number | string`。
5. **输出永远是十进制文本。** 整数完整打印；浮点用最短往返表示（等价 `String(x)`），只有 JS 自身会用指数时才出现指数形式。

## 名称归一化：所有枚举都宽容

所有枚举字段都是自由字符串，服务端会先归一化再匹配：去掉首尾空白、转小写，并把 `-`、`_`、空白视为等价（直接删掉，所以 `"SH L"` 也能读成 `shl`）。返回结果里的名字一律是归一化后的写法。

| 字段 | 可接受写法 | 归一化后 |
| :--- | :--- | :--- |
| `bitwise.operation` | `"XOR"`、`"Xor"`、`"xor"` | 回显为 `"xor"` |
| `round.mode` | `"HALF-EVEN"`、`"half_even"`、`"HALF EVEN"` | 取 `js-round`、`half-up`、`half-even`、`truncate` 之一 |
| `crypto_calc.algorithm` | `"SHA-256"`、`"sha_256"`、`"SHA512"` | 回显为 `"sha256"`、`"sha512"` |
| `crypto_calc.action` | `"HASH"`、`"Mod_Pow"`、`"aes-encrypt"` | 取 `hash`、`hmac`、`aes_encrypt`、`aes_decrypt`、`crc32`、`crc16`、`mod_pow`、`mod_inverse`、`gcd` 之一 |
| `crypto_calc.crcVariant` | `"CCITT"`、`"mod-bus"` | 取 `ccitt` 或 `modbus` |
| `crypto_calc.inputFormat`、`crypto_calc.keyFormat` | `"HEX"`、`"Text"` | 取 `text` 或 `hex` |
| `data_codec.action` | `"TO_HEX"`、`"toHex"`、`"to-hex"`、`"to_hex"` | 取 `to_base64`、`from_base64`、`to_hex`、`from_hex`、`url_encode`、`url_decode` 之一 |
| `data_codec.format` | `"HEX"`、`"Text"` | 取 `text` 或 `hex` |
| `ieee754_convert.precision` | `"FLOAT64"`、`"float_32"` | 取 `float32`、`float64`、`both` 之一 |
| `batch_calc` 步骤里的 `"$cast"` | `"Number"`、`"big_int"`、`"bigint"` | 取 `number`、`bigint`、`string` 之一 |

因为这些字段的可接受写法是开放的，它们在 schema 里声明为 string 而不是 enum，允许值写在每个参数的 description 里。非法值会作为工具错误返回，并把候选值列出来，例如 `Unknown operation "nand"; expected one of: and, or, xor, not, shl, shr, sar, rol, ror`、`Unknown CRC16 variant "xmodem"; expected one of: ccitt, modbus`。

## batch_calc 详解

`batch_calc` 接收有序数组 `steps`。步骤按数组顺序执行，每步是 `{"op": "<工具名>", "args": {...}}`，`args` 用的就是那个单工具自己的参数。

```json
{
  "steps": [
    { "op": "int_convert", "args": { "value": "0x401000", "fields": ["decimal", "hex"] } },
    { "op": "add", "args": { "firstNumber": { "$step": 0, "field": "decimal" }, "secondNumber": 16 } },
    { "op": "int_convert", "args": { "value": { "$step": 1 }, "fields": ["hex"] } }
  ]
}
```

### 三种引用写法

| 写法 | 含义 |
| :--- | :--- |
| `{"$step": 0}` | 取第 0 步的整个结果。适用于该步返回标量（数字文本），或目标参数需要的正是同一个 JSON 结构。 |
| `{"$step": 0, "field": "decimal"}` | 取对象结果中的某个字段。被引用的步骤返回对象时必须这么写：`division` 给 `{value, quotient, remainder}`，`bitwise` 给 `resultHex`，`int_convert` 给 `decimal` / `hex` / `binary` / `bitWidths.bit32.hex`，`data_codec` 给 `hex` / `base64`。 |
| `{"$cast": "bigint", "$step": 0, "field": "decimal"}` | 同上，但使用前先转型。`number` 解析成 JS 数字，`bigint` 返回精确的十进制整数字符串（也接受 `"0x..."`），`string` 把非字符串 JSON 序列化。 |

引用可以出现在 `args` 的任意深度，包括数组内部，但只能指向更早的步骤。指向当前或后续步骤会在执行前整体中止：

- 第 0 步写 `{"$step": 1}` → `Step 0: "$step" cannot be used because there is no earlier step to reference, got 1`
- 第 2 步写 `{"$step": 5}` → `Step 2: "$step" must reference an earlier step (0 to 1), got 5`

### 自动转型

当被引用的值是数字字符串、而目标参数只接受 number 时，会自动转换：`int_convert` 的 `decimal` 可以直接喂给 `sin` 或 `multiply`，不必写 `$cast`。声明为 `number | string` 的参数（`add`、`sum`、`floor`、`round`、`min`、`mode`、`bitwise.a` 等）会原样接收字符串，这正是大整数保持精确的原因。当下游需要精确整数而上游字段是 hex 字符串时，用 `"$cast": "bigint"`。

### 某一步失败后会发生什么

每一步独立校验、独立执行，失败记录下来而不是抛出：

| 结果形态 | 出现时机 |
| :--- | :--- |
| `{"step": 0, "op": "add", "status": "ok", "result": "4198416"}` | 该步正常执行。 |
| `{"step": 0, "op": "bitwise", "status": "error", "error": "Unknown operation \"bogus\"; expected one of: ..."}` | 该步参数或运算失败。 |
| `{"step": 1, "op": "add", "status": "skipped", "reason": "depends on step 0 which is error"}` | 该步引用了没成功的步骤。 |

没有依赖失败步骤的其它步骤照常跑完，一个坏操作数不会让整批作废。只有结构性问题——`$step` 指向前面、索引越界、`op` 不在允许列表——才会中止整个调用。引用了上一步结果里不存在的字段（例如 `add` 之后写 `{"$step": 0, "field": "resultHex"}`）属于单步错误：`Step 0 result has no field "resultHex"`。

由于返回值是 JSON 而不是单工具的文本格式，`batch_calc` 的结果一律要 `JSON.parse`，且 `result` 本身可能是字符串（`"4198416"`）也可能是对象（`int_convert`、`bitwise`、`division`）。

## 实战示例

下面每个输入和输出都是实际跑出来的。

### 示例 1：一次调用完成偏移运算

把 `0x401000` 的十进制值加 16，再输出十六进制和二进制，中间值不经过调用方：

```json
{ "steps": [
  { "op": "int_convert", "args": { "value": "0x401000", "fields": ["decimal", "hex"] } },
  { "op": "add", "args": { "firstNumber": { "$step": 0, "field": "decimal" }, "secondNumber": 16 } },
  { "op": "int_convert", "args": { "value": { "$step": 1 }, "fields": ["hex", "binary"] } }
] }
```

```json
[
  { "step": 0, "op": "int_convert", "status": "ok", "result": { "decimal": "4198400", "hex": "0x401000" } },
  { "step": 1, "op": "add", "status": "ok", "result": "4198416" },
  { "step": 2, "op": "int_convert", "status": "ok", "result": { "hex": "0x401010", "binary": "0b10000000001000000010000" } }
]
```

第 1 步读到的是 `decimal` 字段的字符串，`add` 原样接收，没有任何精度损失；第 2 步把这个数字交回 `int_convert`，它的 `value` 本来就同时接受字符串和数字。

### 示例 2：RSA 式模运算

取教科书的参数 `p = 61`、`q = 53`（于是 `n = 3233`、`φ(n) = 3120`），公钥指数 `e = 17`，私钥指数就是 `e` 的模逆元：

```json
{ "action": "mod_inverse", "a": 17, "modulus": 3120 }
```

```json
{
  "input": "17",
  "modulus": "3120",
  "inverseDec": "2753",
  "inverseHex": "0xac1"
}
```

用它对消息 `42` 加密、再用私钥指数解密：

```json
{ "action": "mod_pow", "a": 42, "b": 17, "modulus": 3233 }
```

```json
{
  "base": "42",
  "exponent": "17",
  "modulus": "3233",
  "resultDec": "2557",
  "resultHex": "0x9fd"
}
```

```json
{ "action": "mod_pow", "a": 2557, "b": 2753, "modulus": 3233 }
```

```json
{
  "base": "2557",
  "exponent": "2753",
  "modulus": "3233",
  "resultDec": "42",
  "resultHex": "0x2a"
}
```

三个调用都支持任意长度操作数，换成真实密钥规模同样可用——而那些中间幂次在定宽整数里早就溢出了。

### 示例 3：读一个 float32 机器字

`0.1` 在二进制浮点里无法精确表示。查看它的 float32 布局，可以看到实际存储值以及这个字的每个位域：

```json
{ "value": 0.1, "precision": "float32" }
```

```json
{
  "input": 0.1,
  "float32": {
    "value": 0.10000000149011612,
    "hex": "0x3dcccccd",
    "binary": "0b00111101110011001100110011001101",
    "signBit": 0,
    "sign": "+",
    "rawExponentHex": "0x7b",
    "rawExponentDec": 123,
    "biasedExponent": -4,
    "mantissaHex": "0x4ccccd",
    "mantissaFraction": 0.6000000238418579,
    "type": "normal"
  }
}
```

反向解析用同一个工具，把 `"value"` 换成 `"0x3dcccccd"` 即可；省略 `precision` 会同时给出该机器字的 float32 和 float64 两种解释。

## 本地开发

```bash
npm install
npm run build      # tsc 编译到 build/，并 chmod +x build/index.js
npm start          # 以 stdio 模式运行编译产物
npm run stdio      # 先构建再启动
npm test           # 用 vitest 跑 src/
```

服务只有一个 ESM 入口（`build/index.js`）。所有工具都由 `src/ops.ts` 里的注册表生成，`batch_calc` 在 `src/index.ts` 中复用同一张表组装。新增一个工具就是往 `ops.ts` 里加一条定义——单工具 schema、文本格式化、`batch_calc` 行为都来自那一条。

## 配套 Agent 技能

`skills/calculate-mcp/SKILL.md` 是给 agent 读的中文速查手册：什么时候该用这个服务、任务与工具的对应关系、最容易记混的参数名、以及每条常见报错原文和改法。安装方式是把整个目录复制进 agent 的 skills 目录：

```powershell
# Windows (PowerShell)
Copy-Item -Recurse -Force "skills/calculate-mcp" "$HOME/.agents/skills/"
```

```bash
# Linux / macOS
cp -r skills/calculate-mcp ~/.agents/skills/
```

## 开源协议

[MIT](https://github.com/KonghuanSmart/calculate-mcp/blob/main/LICENSE) © 2025 Ethan Henrickosn
