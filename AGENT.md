# vite-slang 项目分析报告

## 项目概述

**vite-slang** 是一个专为 Vite 构建工具设计的插件，用于在 Web 环境中编译和运行 Slang 着色器。该项目将 Slang 着色器语言编译为 WebGPU 着色器语言 (WGSL)，使得开发者可以在现代 Web 应用中使用高级着色器编程。

### 核心特性

- 🎨 **Slang 着色器编译**: 将 Slang 着色器代码编译为 WGSL
- 🌐 **Web 支持**: 专为 WebGL/WebGPU 环境设计
- 📦 **Vite 集成**: 作为 Vite 插件无缝集成到构建流程
- 🔧 **TypeScript 支持**: 完整的类型定义和智能提示
- 📁 **模块化支持**: 支持 `#include` 指令进行模块化开发
- 🔍 **反射信息**: 提供详细的着色器反射元数据

## 技术架构

### 项目结构

```
vite-slang/
├── src/
│   ├── index.js              # 主插件实现
│   ├── index.d.ts           # TypeScript 类型定义
│   ├── slang.d.ts           # Slang 反射类型定义
│   └── slang-2025.17-wasm/  # Slang WASM 编译器和接口
│       ├── slang-wasm.js    # WASM 加载器
│       ├── slang-wasm.wasm  # Slang 编译器 WASM 二进制
│       └── interface.d.ts   # WASM 接口类型定义
├── tests/                   # 测试文件和示例着色器
└── package.json            # 项目配置
```

### 核心组件

#### 1. 主插件 (`src/index.js`)

```javascript
function viteSlang(options) {
  options = { target: 'WGSL', filter: /\.slang$/, ...options }
  
  return {
    name: 'vite-slang',
    transform: {
      filter: { id: options.filter },
      async handler(code, id) {
        // 编译 Slang 着色器到 WGSL
        // 处理 #include 指令
        // 生成反射信息
        // 返回编译后的代码
      }
    }
  }
}
```

**关键功能:**
- **懒加载 WASM**: 延迟加载 Slang WASM 模块以支持多种模块系统
- **目标编译**: 将 Slang 编译为 WGSL（WebGPU 着色器语言）
- **包含处理**: 解析 `#include` 指令并内联包含文件
- **错误处理**: 提供详细的编译错误信息
- **反射生成**: 生成着色器元数据用于运行时绑定

#### 2. Slang WASM 集成

项目集成了 Slang 2025.17 版本的 WASM 编译器，提供：

- **GlobalSession**: 全局编译器会话管理
- **Session**: 特定目标的编译会话
- **Module**: 着色器模块加载和验证
- **ComponentType**: 着色器组件类型和链接
- **ProgramLayout**: 程序布局和反射信息

#### 3. 类型系统

完整的 TypeScript 类型定义包括：

- **ViteSlangOptions**: 插件配置选项
- **SlangReflectionJSON**: 着色器反射数据结构
- **SlangCompileTarget**: 支持的编译目标（目前仅 WGSL）
- **模块声明**: `*.slang` 文件的模块类型定义

## 使用方式

### 基本配置

```javascript
// vite.config.js
import { defineConfig } from 'vite'
import slang from 'vite-slang'

export default defineConfig({
  plugins: [slang()]
})
```

### 着色器编写

```slang
// shader.slang
cbuffer Globals: register(b0, space0) {
  float time;
};

[shader("vertex")]
float4 vmain(uint vertexIndex: SV_VertexID): SV_Position {
  float2 uv = float2((vertexIndex << 1) & 2, vertexIndex & 2);
  return float4(uv * 2.0 - 1.0, 0.0, 1.0);
}

[shader("fragment")]
float4 fmain(float4 position: SV_Position): SV_Target {
  float2 coord = position.xy / position.w;
  float3 color = float3(0.8, 0.7, 1.0) + 0.3 * cos(normalize(coord).xyx + time);
  return float4(color, 1.0);
}
```

### JavaScript 使用

```javascript
// app.js
import { code, reflection } from './shader.slang'

const shader = device.createShaderModule({ code })

const pipeline = device.createRenderPipeline({
  vertex: {
    module: shader,
    entryPoint: 'vmain',
  },
  fragment: {
    module: shader,
    entryPoint: 'fmain',
    targets: [{ format: 'bgra8unorm' }],
  },
  layout: 'auto',
})

console.log(reflection) // 着色器元数据
```

## 编译流程

### 1. 文件过滤
插件使用配置的过滤器（默认 `/\.slang$/`）识别需要处理的文件。

### 2. WASM 初始化
- 懒加载 Slang WASM 模块
- 创建全局会话
- 初始化目标编译器（WGSL）

### 3. 预处理
- 解析 `#include` 指令
- 读取并内联包含文件
- 处理相对路径解析

### 4. 编译过程
```javascript
// 创建会话和模块
const session = globalSession.createSession(wasmCompileTarget)
const module = session.loadModuleFromSource(processedCode, 'shader', id)

// 验证入口点
const count = module.getDefinedEntryPointCount()
if (count === 0) {
  throw new Error('必须定义着色器入口点')
}

// 链接和编译
const linkedProgram = session.createCompositeComponentType(components).link()
const shader = linkedProgram.getTargetCode(0)
const reflection = linkedProgram.getLayout(0).toJsonObject()
```

### 5. 输出生成
生成包含编译后 WGSL 代码和反射信息的 ES 模块：

```javascript
export const code = `编译后的WGSL代码`;
export const reflection = { /* 反射元数据 */ };
export default code;
```

## 配置选项

### ViteSlangOptions

```typescript
interface ViteSlangOptions {
  /**
   * 编译目标，默认为 'WGSL'
   */
  target?: SlangCompileTarget
  
  /**
   * 文件过滤器，默认为 /\.slang$/
   */
  filter?: StringFilter<string | RegExp>
}
```

### 支持的过滤器类型

- **字符串**: 精确匹配文件路径
- **正则表达式**: 模式匹配
- **数组**: 多个过滤条件的并集
- **对象**: 包含 `include`/`exclude` 的复杂过滤

## 反射系统

编译后的着色器提供丰富的反射信息：

### 入口点信息
```typescript
interface SlangReflectionEntryPoint {
  name: string              // 入口点名称
  parameters: SlangReflectionParameter[]  // 参数列表
  stage: string            // 着色器阶段 (vertex/fragment/compute)
  threadGroupSize: [number, number, number]  // 计算着色器线程组大小
}
```

### 参数绑定
```typescript
interface SlangReflectionParameter {
  name: string
  binding: SlangReflectionBinding  // 绑定信息
  type: SlangReflectionType        // 类型信息
  format?: SlangFormat            // 格式信息（如适用）
}
```

### 支持的类型系统

- **标量类型**: `uint32`, `int32`, `float32`, `float64` 等
- **向量类型**: `vec2`, `vec3`, `vec4` 等
- **结构体**: 自定义结构体类型
- **资源类型**: 纹理、采样器、缓冲区等
- **格式**: 各种纹理和缓冲区格式

## 错误处理

插件提供详细的错误信息：

### 编译错误
```javascript
// 着色器语法错误
"USER error: ./shader.slang(4): error 30015: undefined identifier 'error'"

// 缺少入口点
"An entrypoint must be defined with a shader stage attribute! Try adding [shader(\"fragment\")] before your entrypoint method."

// 不支持的编译目标
"Unsupported Slang target: unsupported"
```

### 包含错误
```javascript
// 找不到包含文件
"USER error: ./shader.slang(4): error 15300: failed to find include file 'missing.slang'"
```

## 测试覆盖

项目包含完整的测试套件：

### 测试用例
1. **基本编译**: 验证 Slang 到 WGSL 的编译
2. **包含处理**: 测试 `#include` 指令解析
3. **错误处理**: 验证各种错误情况的处理
4. **类型安全**: 确保 TypeScript 类型正确性

### 测试着色器示例
- `triangle.slang`: 完整的顶点/片段着色器示例
- `include-0.slang`: 包含指令测试
- `broken.slang`: 编译错误测试
- `empty.slang`: 缺少入口点测试

## 性能考虑

### WASM 加载优化
- **懒加载**: 只在需要时加载 WASM 模块
- **会话复用**: 全局会话避免重复初始化
- **内存管理**: 及时释放编译器会话资源

### 编译缓存
- **Vite 缓存**: 利用 Vite 的模块缓存机制
- **增量编译**: 只重新编译修改的文件

## 兼容性

### 浏览器支持
- **WebGPU**: 需要支持 WebGPU 的现代浏览器
- **WebGL**: 通过 WGSL 转换支持 WebGL 2.0

### 构建工具支持
- **Vite**: 主要目标平台
- **ESM/CJS/UMD**: 支持多种模块系统

## 开发指南

### 本地开发
```bash
# 安装依赖
yarn install

# 运行测试
yarn test

# 类型检查
yarn tsc
```

### 贡献指南
1. 遵循现有的代码风格
2. 添加适当的测试用例
3. 更新类型定义
4. 确保向后兼容性

## 未来规划

### 计划功能
- **多目标支持**: 支持 HLSL、GLSL、Metal 等其他目标
- **GLES 支持**: 等待 Slang 上游支持 GLES+web
- **热重载**: 开发时的实时着色器更新
- **性能分析**: 着色器性能分析和优化建议

### 技术债务
- **更好的布局反射**: 改进程序布局反射机制
- **源映射**: 支持 WGSL 源映射
- **错误位置**: 改进错误位置报告

## 总结

vite-slang 是一个设计精良的 Vite 插件，为 Web 着色器开发提供了强大的工具链。通过集成 Slang 编译器，它使得开发者可以使用现代着色器语言特性，同时保持与 Web 平台的兼容性。项目的模块化设计、完整的类型系统和详细的错误处理使其成为 Web 图形编程的优秀选择。

该插件特别适合：
- Web 游戏开发
- 数据可视化应用
- 创意编程项目
- 科学计算可视化
- Web 3D 应用开发

通过持续的技术改进和社区贡献，vite-slang 有望成为 Web 着色器开发的标准工具之一。
