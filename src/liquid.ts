import { Context } from './context/context'
import * as fs from './fs/node'
import * as _ from './util/underscore'
import { Template } from './template/template'
import { Tokenizer } from './parser/tokenizer'
import { Render } from './render/render'
import Parser from './parser/parser'
import { TagImplOptions } from './template/tag/tag-impl-options'
import { Value } from './template/value'
import builtinTags from './builtin/tags'
import builtinFilters from './builtin/filters'
import { TagMap } from './template/tag/tag-map'
import { FilterMap } from './template/filter/filter-map'
import { LiquidOptions, normalizeStringArray, NormalizedFullOptions, applyDefault, normalize } from './liquid-options'
import { FilterImplOptions } from './template/filter/filter-impl-options'
import { FS } from './fs/fs'
import { toThenable, toValue } from './util/async'

export * from './types'

export class Liquid {
  public options: NormalizedFullOptions
  public renderer: Render
  public parser: Parser
  public filters: FilterMap
  public tags: TagMap
  private fs: FS

  public constructor (opts: LiquidOptions = {}) {
    this.options = applyDefault(normalize(opts))
    this.parser = new Parser(this)
    this.renderer = new Render()
    this.fs = opts.fs || fs
    this.filters = new FilterMap(this.options.strictFilters)
    this.tags = new TagMap()

    _.forOwn(builtinTags, (conf, name) => this.registerTag(name, conf))
    _.forOwn(builtinFilters, (handler, name) => this.registerFilter(name, handler))
  }
  public parse (html: string, filepath?: string): Template[] {
    const tokenizer = new Tokenizer(html, filepath)
    const tokens = tokenizer.readTopLevelTokens(this.options)
    return this.parser.parse(tokens)
  }

  public _render (tpl: Template[], scope?: object, opts?: LiquidOptions, sync?: boolean): IterableIterator<string> {
    const options = { ...this.options, ...normalize(opts) }
    const ctx = new Context(scope, options, sync)
    return this.renderer.renderTemplates(tpl, ctx)
  }
  public async render (tpl: Template[], scope?: object, opts?: LiquidOptions): Promise<string> {
    return toThenable(this._render(tpl, scope, opts, false))
  }
  public renderSync (tpl: Template[], scope?: object, opts?: LiquidOptions): string {
    return toValue(this._render(tpl, scope, opts, true))
  }

  public _parseAndRender (html: string, scope?: object, opts?: LiquidOptions, sync?: boolean): IterableIterator<string> {
    const tpl = this.parse(html)
    return this._render(tpl, scope, opts, sync)
  }
  public async parseAndRender (html: string, scope?: object, opts?: LiquidOptions): Promise<string> {
    return toThenable(this._parseAndRender(html, scope, opts, false))
  }
  public parseAndRenderSync (html: string, scope?: object, opts?: LiquidOptions): string {
    return toValue(this._parseAndRender(html, scope, opts, true))
  }

  public * _parseFile (file: string, opts?: LiquidOptions, sync?: boolean) {
    const options = { ...this.options, ...normalize(opts) }
    const paths = options.root.map(root => this.fs.resolve(root, file, options.extname))
    if (this.fs.fallback !== undefined) {
      const filepath = this.fs.fallback(file)
      if (filepath !== undefined) paths.push(filepath)
    }

    for (const filepath of paths) {
      const { cache } = this.options
      if (cache) {
        const tpls = yield cache.read(filepath)
        if (tpls) return tpls
      }
      if (!(sync ? this.fs.existsSync(filepath) : yield this.fs.exists(filepath))) continue
      const tpl = this.parse(sync ? this.fs.readFileSync(filepath) : yield this.fs.readFile(filepath), filepath)
      if (cache) cache.write(filepath, tpl)
      return tpl
    }
    throw this.lookupError(file, options.root)
  }
  public async parseFile (file: string, opts?: LiquidOptions): Promise<Template[]> {
    return toThenable(this._parseFile(file, opts, false))
  }
  public parseFileSync (file: string, opts?: LiquidOptions): Template[] {
    return toValue(this._parseFile(file, opts, true))
  }
  public async renderFile (file: string, ctx?: object, opts?: LiquidOptions) {
    const templates = await this.parseFile(file, opts)
    return this.render(templates, ctx, opts)
  }
  public renderFileSync (file: string, ctx?: object, opts?: LiquidOptions) {
    const options = normalize(opts)
    const templates = this.parseFileSync(file, options)
    return this.renderSync(templates, ctx, opts)
  }

  public _evalValue (str: string, ctx: Context): IterableIterator<any> {
    const value = new Value(str, this.filters)
    return value.value(ctx)
  }
  public async evalValue (str: string, ctx: Context): Promise<any> {
    return toThenable(this._evalValue(str, ctx))
  }
  public evalValueSync (str: string, ctx: Context): any {
    return toValue(this._evalValue(str, ctx))
  }

  public registerFilter (name: string, filter: FilterImplOptions) {
    this.filters.set(name, filter)
  }
  public registerTag (name: string, tag: TagImplOptions) {
    this.tags.set(name, tag)
  }
  public plugin (plugin: (this: Liquid, L: typeof Liquid) => void) {
    return plugin.call(this, Liquid)
  }
  public express () {
    const self = this // eslint-disable-line
    return function (this: any, filePath: string, ctx: object, callback: (err: Error | null, rendered: string) => void) {
      const opts = { root: [...normalizeStringArray(this.root), ...self.options.root] }
      self.renderFile(filePath, ctx, opts).then(html => callback(null, html) as any, callback as any)
    }
  }

  private lookupError (file: string, roots: string[]) {
    const err = new Error('ENOENT') as any
    err.message = `ENOENT: Failed to lookup "${file}" in "${roots}"`
    err.code = 'ENOENT'
    return err
  }

  /**
   * @deprecated use parseFile instead
   */
  public async getTemplate (file: string, opts?: LiquidOptions): Promise<Template[]> {
    return this.parseFile(file, opts)
  }
  /**
   * @deprecated use parseFileSync instead
   */
  public getTemplateSync (file: string, opts?: LiquidOptions): Template[] {
    return this.parseFileSync(file, opts)
  }
}
