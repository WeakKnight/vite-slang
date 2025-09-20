import { transformWithEsbuild } from 'vite'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { SlangCompiler } from './slangc.js'

/**
 * Tests a Vite filter against a file id.
 *
 * @param {String} id
 * @param {Exclude<import('./index.js').ViteSlangOptions['filter'], undefined>} filter
 */
function testFilter(id, filter) {
  if (typeof filter === 'string') {
    return id === filter
  } else if (filter instanceof RegExp) {
    return filter.test(id)
  } else if (Array.isArray(filter)) {
    for (const test of filter) {
      if (testFilter(id, test)) return true
    }
    return false
  } else if (filter.exclude || filter.include) {
    if (filter.exclude && testFilter(id, filter.exclude)) return false
    if (filter.include && !testFilter(id, filter.include)) return false
    return true
  }
}

const SLANG_STAGES = {
  vertex: 1,
  fragment: 5,
  compute: 6,
}

const IMPORT_REGEX = /^\s*#include\s+"([^"]+)"/gm

// 全局编译器实例
let globalCompiler = null

/**
 * @param {import('./index.js').ViteSlangOptions} options
 * @returns {import('vite').PluginOption}
 */
function viteSlang(options) {
  options = { target: 'WGSL', filter: /\.slang$/, ...options }

  return {
    name: 'vite-slang',
    transform: {
      // NOTE: ideally, we can evaluate and parse Slang written in JS (e.g., /* slang */ `...`),
      // but Slang expects a full program which does not allow for this dynamic compilation at run-time.
      // For now, we only handle files with a .slang file extension (default). These are transformed as source code.
      filter: {
        id: options.filter,
      },
      async handler(code, id) {
        // Backwards compat for non-Rolldown clients
        // https://github.com/CodyJasonBennett/vite-slang/issues/1
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
