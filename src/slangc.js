import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import * as fs from 'node:fs/promises'
import * as fsSync from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { getSlangcPath } from './platform.js'

const execFileAsync = promisify(execFile)

// Import regex from existing code
const IMPORT_REGEX = /^\s*#include\s+"([^"]+)"/gm

export class SlangCompiler {
  constructor(options) {
    this.target = options.target || 'WGSL'
    this.slangcPath = getSlangcPath()
    
    // 验证目标格式
    this.validateTarget()
  }

  validateTarget() {
    const validTargets = [
      'unknown', 'none', 'hlsl', 'dxbc', 'dxbc-asm', 'dxbc-assembly', 'dxil', 'dxil-asm', 'dxil-assembly',
      'glsl', 'spirv', 'spirv-asm', 'spirv-assembly', 'c', 'cpp', 'c++', 'cxx', 'torch', 'torch-binding',
      'torch-cpp', 'torch-cpp-binding', 'host-cpp', 'host-c++', 'host-cxx', 'exe', 'executable',
      'shader-sharedlib', 'shader-sharedlibrary', 'shader-dll', 'sharedlib', 'sharedlibrary', 'dll',
      'cuda', 'cu', 'ptx', 'cuobj', 'cubin', 'host-callable', 'callable', 'object-code',
      'host-host-callable', 'metal', 'metallib', 'metallib-asm', 'wgsl', 'wgsl-spirv-asm',
      'wgsl-spirv-assembly', 'wgsl-spirv', 'slangvm', 'slang-vm'
    ]
    
    if (!validTargets.includes(this.target.toLowerCase())) {
      throw new Error(`Unsupported Slang target: ${this.target}.`)
    }
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
        return fsSync.readFileSync(path.resolve(path.dirname(basePath), file), { encoding: 'utf8' })
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
      '-target', this.target.toLowerCase(),
      '-reflection-json', tempFiles.reflection,
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
