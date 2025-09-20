# vite-slang 命令行版本开发计划

## 项目目标

将 vite-slang 从 Slang WASM 版本迁移到使用 `slangc` 命令行工具，以解决 WASM 版本的 bug 问题，提升稳定性和性能。

## 技术方案

### 核心架构

```
Vite Plugin → slangc 调用 → 返回编译结果 + 反射 JSON
     ↓
预处理 #include → 临时文件 → slangc 编译 → 解析输出
```

### 关键特性

- ✅ **反射信息**: 使用 `slangc -reflection-json` 直接输出 JSON
- ✅ **include 处理**: 复用现有的 `IMPORT_REGEX` 预处理逻辑
- ✅ **稳定性**: 使用原生命令行工具，避免 WASM bug
- ✅ **包内分发**: slangc 二进制直接打包在 npm 包中

## 实现规划

### 1. 项目结构调整

```
vite-slang/
├── src/
│   ├── index.js              # 主插件逻辑（修改现有）
│   ├── slangc.js            # slangc 调用封装（新增）
│   ├── slang.d.ts           # 类型定义（保持不变）
│   └── slang-2025.17-wasm/  # 移除整个目录
├── platforms/               # 新增：平台特定的 slangc 二进制
│   ├── windows-x64/
│   │   └── slangc.exe
│   ├── darwin-x64/
│   │   └── slangc
│   ├── darwin-arm64/
│   │   └── slangc
│   └── linux-x64/
│       └── slangc
└── package.json             # 更新依赖和脚本

Windows的slangc需要的文件全都在这里了 slang\slang-2025.17-windows-x86_64\bin, 先按目录调整规划把windows的拷贝进去吧, 其他平台以后再处理

```

### 2. 核心模块设计

#### A. 平台检测和路径管理 (`src/platform.js`)

```javascript
import * as os from 'node:os'
import * as path from 'node:path'

function detectPlatform() {
  const platform = process.platform
  const arch = process.arch
  
  if (platform === 'win32' && arch === 'x64') return 'windows-x64'
  if (platform === 'darwin' && arch === 'x64') return 'darwin-x64'
  if (platform === 'darwin' && arch === 'arm64') return 'darwin-arm64'
  if (platform === 'linux' && arch === 'x64') return 'linux-x64'
  
  throw new Error(`Unsupported platform: ${platform}-${arch}`)
}

export function getSlangcPath() {
  const platform = detectPlatform()
  return path.join(process.cwd(), 'platforms', platform, 'slangc')
}
```

#### B. slangc 调用封装 (`src/slangc.js`)

```javascript
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as os from 'node:os'
import { IMPORT_REGEX } from './index.js'

const execFileAsync = promisify(execFile)

export class SlangCompiler {
  constructor(options) {
    this.target = options.target || 'WGSL'
    this.slangcPath = getSlangcPath()
  }

  async compile(source, filePath) {
    // 1. 预处理 #include 指令（复用现有逻辑）
    const processedSource = this.preprocessIncludes(source, filePath)
    
    // 2. 创建临时文件
    const tempFiles = await this.createTempFiles(processedSource)
    
    try {
      // 3. 调用 slangc
      const result = await this.runSlangc(tempFiles)
      return result
    } finally {
      // 4. 清理临时文件
      await this.cleanup(tempFiles)
    }
  }

  preprocessIncludes(source, basePath) {
    // 直接复用现有的 IMPORT_REGEX 处理逻辑
    return source.replaceAll(IMPORT_REGEX, (match, file) => {
      try {
        return fs.readFileSync(path.resolve(path.dirname(basePath), file), { encoding: 'utf8' })
      } catch {
        return match
      }
    })
  }

  async createTempFiles(source) {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vite-slang-'))
    const tempSlang = path.join(tempDir, 'shader.slang')
    const tempReflection = path.join(tempDir, 'reflection.json')
    const tempOutput = path.join(tempDir, 'shader.wgsl')
    
    await fs.writeFile(tempSlang, source)
    
    return {
      slang: tempSlang,
      reflection: tempReflection,
      output: tempOutput,
      dir: tempDir
    }
  }

  async runSlangc(tempFiles) {
    const args = [
      tempFiles.slang,
      `-target=${this.target}`,
      `-reflection-json=${tempFiles.reflection}`,
      '-o', tempFiles.output
    ]
    
    try {
      await execFileAsync(this.slangcPath, args)
      
      // 读取编译结果
      const [wgslCode, reflectionJson] = await Promise.all([
        fs.readFile(tempFiles.output, 'utf8'),
        fs.readFile(tempFiles.reflection, 'utf8')
      ])
      
      const reflection = JSON.parse(reflectionJson)
      return { code: wgslCode, reflection }
      
    } catch (error) {
      throw new Error(`Slang compilation failed: ${error.stderr || error.message}`)
    }
  }

  async cleanup(tempFiles) {
    try {
      await fs.rm(tempFiles.dir, { recursive: true, force: true })
    } catch {
      // 忽略清理错误
    }
  }
}
```

#### C. 主插件逻辑修改 (`src/index.js`)

```javascript
import { transformWithEsbuild } from 'vite'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { SlangCompiler } from './slangc.js'

// 保留现有的过滤器测试逻辑
function testFilter(id, filter) {
  // ... 现有实现保持不变
}

const SLANG_STAGES = {
  vertex: 1,
  fragment: 5,
  compute: 6,
}

const IMPORT_REGEX = /^\s*#include\s+"([^"]+)"/gm

// 全局编译器实例
let globalCompiler = null

function viteSlang(options) {
  options = { target: 'WGSL', filter: /\.slang$/, ...options }

  return {
    name: 'vite-slang',
    transform: {
      filter: { id: options.filter },
      async handler(code, id) {
        // 向后兼容 Rolldown 客户端
        if (!testFilter(id, options.filter)) return

        try {
          // 懒初始化编译器
          if (!globalCompiler) {
            globalCompiler = new SlangCompiler(options)
          }

          // 调用 slangc 编译
          const { code: wgslCode, reflection } = await globalCompiler.compile(code, id)
          
          // 生成 ES 模块（保持现有格式）
          const moduleCode = `export const code = \`${wgslCode}\`;export const reflection = ${JSON.stringify(reflection)};export default code;`
          
          return transformWithEsbuild(moduleCode, id, {
            format: 'esm',
            loader: 'js',
            sourcemap: 'external',
          })
        } catch (error) {
          // 错误处理（保持现有格式）
          throw new Error(`[vite-slang] ${error.message}\nfile: ${id}`)
        }
      },
    },
  }
}

export default viteSlang
```

### 3. 包管理配置

#### A. package.json 更新

```json
{
  "name": "vite-slang",
  "version": "0.3.0",
  "description": "Vite plugin to use Slang shaders on the web.",
  "files": [
    "src/*",
    "platforms/**/*"
  ],
  "scripts": {
    "test": "vitest run && tsc",
    "postinstall": "node scripts/setup-platforms.js"
  },
  "bin": {
    "slangc": "./platforms/current/slangc"
  }
}
```

#### B. 平台设置脚本 (`scripts/setup-platforms.js`)

```javascript
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

function detectPlatform() {
  const platform = process.platform
  const arch = process.arch
  
  if (platform === 'win32' && arch === 'x64') return 'windows-x64'
  if (platform === 'darwin' && arch === 'x64') return 'darwin-x64'
  if (platform === 'darwin' && arch === 'arm64') return 'darwin-arm64'
  if (platform === 'linux' && arch === 'x64') return 'linux-x64'
  
  throw new Error(`Unsupported platform: ${platform}-${arch}`)
}

async function setupPlatforms() {
  const platform = detectPlatform()
  const sourceDir = path.join(process.cwd(), 'platforms', platform)
  const targetDir = path.join(process.cwd(), 'platforms', 'current')
  
  // 创建当前平台符号链接
  if (fs.existsSync(targetDir)) {
    fs.rmSync(targetDir, { recursive: true })
  }
  
  fs.symlinkSync(sourceDir, targetDir, 'dir')
  
  // 设置执行权限（Unix 系统）
  if (process.platform !== 'win32') {
    const slangcPath = path.join(sourceDir, 'slangc')
    if (fs.existsSync(slangcPath)) {
      fs.chmodSync(slangcPath, 0o755)
    }
  }
}

setupPlatforms().catch(console.error)
```

### 4. 二进制文件管理

#### A. 下载脚本 (`scripts/download-slangc.js`)

```javascript
import * as https from 'node:https'
import * as fs from 'node:fs'
import * as path from 'node:path'

const SLANG_VERSION = '2025.17'
const PLATFORMS = [
  { name: 'windows-x64', url: `https://github.com/shader-slang/slang/releases/download/v${SLANG_VERSION}/slang-${SLANG_VERSION}-windows-x86_64.zip` },
  { name: 'darwin-x64', url: `https://github.com/shader-slang/slang/releases/download/v${SLANG_VERSION}/slang-${SLANG_VERSION}-macos-x86_64.zip` },
  { name: 'darwin-arm64', url: `https://github.com/shader-slang/slang/releases/download/v${SLANG_VERSION}/slang-${SLANG_VERSION}-macos-arm64.zip` },
  { name: 'linux-x64', url: `https://github.com/shader-slang/slang/releases/download/v${SLANG_VERSION}/slang-${SLANG_VERSION}-linux-x86_64.zip` }
]

async function downloadAndExtract(platform) {
  // 实现下载和解压逻辑
  // 提取 slangc 二进制到对应平台目录
}

// 下载所有平台的二进制文件
Promise.all(PLATFORMS.map(downloadAndExtract))
```

## 实施步骤

### 阶段一：基础架构搭建
1. 创建 `src/slangc.js` 和 `src/platform.js`
2. 实现基本的 slangc 调用封装
3. 创建平台目录结构

### 阶段二：插件集成
1. 修改 `src/index.js`，移除 WASM 相关代码
2. 集成 SlangCompiler 类
3. 保持现有的 API 和错误处理格式

### 阶段三：二进制管理
1. 实现二进制文件下载脚本
2. 创建平台设置脚本
3. 更新 package.json 配置

### 阶段四：测试和优化
1. 运行现有测试套件
2. 跨平台测试
3. 性能对比测试
4. 错误处理完善

### 阶段五：清理和发布
1. 移除 `src/slang-2025.17-wasm/` 目录
2. 更新文档和示例
3. 版本发布

## 风险评估

### 低风险
- **API 兼容性**: 保持现有的导入和导出格式
- **错误处理**: 可以保持现有的错误消息格式
- **include 处理**: 直接复用现有逻辑

### 中风险
- **跨平台兼容性**: 需要测试不同平台的二进制文件
- **临时文件管理**: 需要确保清理逻辑的可靠性

### 高风险
- **包大小**: 包含多个平台的二进制文件会增加包大小
- **权限问题**: 某些平台可能需要特殊的权限设置

## 预期收益

1. **稳定性提升**: 使用官方命令行工具，bug 更少
2. **性能优化**: 原生二进制比 WASM 性能更好
3. **功能完整**: 支持所有 Slang 特性
4. **维护简化**: 不需要维护 WASM 绑定代码
5. **开发体验**: 更好的错误信息和调试支持

## 时间估算

- **阶段一**: 2-3 天
- **阶段二**: 1-2 天  
- **阶段三**: 2-3 天
- **阶段四**: 2-3 天
- **阶段五**: 1 天

**总计**: 8-12 天

这个计划更加简洁实用，专注于核心功能的实现。你觉得这个规划如何？
