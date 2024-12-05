/*!
 * express
 * Copyright(c) 2009-2013 TJ Holowaychuk
 * Copyright(c) 2013 Roman Shtylman
 * Copyright(c) 2014-2015 Douglas Christopher Wilson
 * MIT Licensed
 */

'use strict';

/**
 * Module dependencies.
 * @private
 */
// 引入所需的模块
var finalhandler = require('finalhandler');
var Router = require('./router');
var methods = require('methods');
var middleware = require('./middleware/init');
var query = require('./middleware/query');
var debug = require('debug')('express:application');
var View = require('./view');
var http = require('http');
var compileETag = require('./utils').compileETag;
var compileQueryParser = require('./utils').compileQueryParser;
var compileTrust = require('./utils').compileTrust;
var deprecate = require('depd')('express');
var flatten = require('array-flatten');
var merge = require('utils-merge');
var resolve = require('path').resolve;
var setPrototypeOf = require('setprototypeof');

/**
 * Module variables.
 * @private
 */
// 定义私有变量
var hasOwnProperty = Object.prototype.hasOwnProperty;
var slice = Array.prototype.slice;

/**
 * Application prototype.
 */
// 定义应用程序的原型对象
var app = exports = module.exports = {};

/**
 * Variable for trust proxy inheritance back-compat
 * @private
 */
// 用于信任代理的默认符号
var trustProxyDefaultSymbol = '@@symbol:trust_proxy_default';

/**
 * Initialize the server.
 *
 *   - setup default configuration
 *   - setup default middleware
 *   - setup route reflection methods
 *
 * @private
 */
// 初始化服务器
app.init = function init() {
  this.cache = {}; // 缓存
  this.engines = {}; // 模板引擎
  this.settings = {}; // 配置

  this.defaultConfiguration(); // 设置默认配置
};

/**
 * Initialize application configuration.
 * @private
 */
// 初始化应用程序配置
app.defaultConfiguration = function defaultConfiguration() {
  var env = process.env.NODE_ENV || 'development'; // 获取环境变量

  // 设置默认配置
  this.enable('x-powered-by');
  this.set('etag', 'weak');
  this.set('env', env);
  this.set('query parser', 'extended');
  this.set('subdomain offset', 2);
  this.set('trust proxy', false);

  // 兼容旧版信任代理
  Object.defineProperty(this.settings, trustProxyDefaultSymbol, {
    configurable: true,
    value: true
  });

  debug('booting in %s mode', env);

  this.on('mount', function onmount(parent) {
    // 继承信任代理
    if (this.settings[trustProxyDefaultSymbol] === true
      && typeof parent.settings['trust proxy fn'] === 'function') {
      delete this.settings['trust proxy'];
      delete this.settings['trust proxy fn'];
    }

    // 继承原型
    setPrototypeOf(this.request, parent.request);
    setPrototypeOf(this.response, parent.response);
    setPrototypeOf(this.engines, parent.engines);
    setPrototypeOf(this.settings, parent.settings);
  });

  // 设置本地变量
  this.locals = Object.create(null);

  // 顶级应用挂载在 /
  this.mountpath = '/';

  // 默认本地变量
  this.locals.settings = this.settings;

  // 默认配置
  this.set('view', View);
  this.set('views', resolve('views'));
  this.set('jsonp callback name', 'callback');

  if (env === 'production') {
    this.enable('view cache');
  }

  Object.defineProperty(this, 'router', {
    get: function() {
      throw new Error('\'app.router\' is deprecated!\nPlease see the 3.x to 4.x migration guide for details on how to update your app.');
    }
  });
};

/**
 * lazily adds the base router if it has not yet been added.
 *
 * We cannot add the base router in the defaultConfiguration because
 * it reads app settings which might be set after that has run.
 *
 * @private
 */
// 延迟添加基础路由器
app.lazyrouter = function lazyrouter() {
  /**
   * 如果还没有路由器，则创建一个新的路由器
   */
  if (!this._router) {
    /**
     * 创建一个新的路由器
     * 根据配置设置大小写敏感和严格路由
     */
    this._router = new Router({
      caseSensitive: this.enabled('case sensitive routing'),
      strict: this.enabled('strict routing')
    });
    /**
     * 使用查询解析器中间件
     */
    this._router.use(query(this.get('query parser fn')));
    /**
     * 使用初始化中间件
     */
    this._router.use(middleware.init(this));
  }
};

/**
 * Dispatch a req, res pair into the application. Starts pipeline processing.
 *
 * If no callback is provided, then default error handlers will respond
 * in the event of an error bubbling through the stack.
 *
 * @private
 */
// 处理请求和响应
app.handle = function handle(req, res, callback) {
  var router = this._router;

  // 最终处理器
  var done = callback || finalhandler(req, res, {
    env: this.get('env'),
    onerror: logerror.bind(this)
  });

  // 没有路由
  if (!router) {
    debug('no routes defined on app');
    done();
    return;
  }

  router.handle(req, res, done);
};

/**
 * Proxy `Router#use()` to add middleware to the app router.
 * See Router#use() documentation for details.
 *
 * If the _fn_ parameter is an express app, then it will be
 * mounted at the _route_ specified.
 *
 * @public
 */
// 添加中间件到应用路由器
app.use = function use(fn) {
  var offset = 0;
  var path = '/';

  // 默认路径为 '/'
  // 区分 app.use([fn])
  if (typeof fn !== 'function') {
    var arg = fn;

    while (Array.isArray(arg) && arg.length !== 0) {
      arg = arg[0];
    }

    // 第一个参数是路径
    if (typeof arg !== 'function') {
      offset = 1;
      path = fn;
    }
  }
  /**
   * 如果是数组，则扁平化
   * 扁平化就是将数组中的所有元素展开成一个一维数组
   */
  var fns = flatten(slice.call(arguments, offset));
  /**
   * 如果数组为空，则抛出错误
   */
  if (fns.length === 0) {
    throw new TypeError('app.use() requires a middleware function');
  }

  // 设置路由器
  this.lazyrouter();
  var router = this._router;

  fns.forEach(function (fn) {
    // 非 express 应用
    if (!fn || !fn.handle || !fn.set) {
      return router.use(path, fn);
    }

    debug('.use app under %s', path);
    fn.mountpath = path;
    fn.parent = this;

    // 恢复 req 和 res 上的 .app 属性
    router.use(path, function mounted_app(req, res, next) {
      var orig = req.app;
      fn.handle(req, res, function (err) {
        setPrototypeOf(req, orig.request);
        setPrototypeOf(res, orig.response);
        next(err);
      });
    });

    // 挂载应用
    fn.emit('mount', this);
  }, this);

  return this;
};

/**
 * Proxy to the app `Router#route()`
 * Returns a new `Route` instance for the _path_.
 *
 * Routes are isolated middleware stacks for specific paths.
 * See the Route api docs for details.
 *
 * @public
 */
// 创建路由
app.route = function route(path) {
  this.lazyrouter();
  return this._router.route(path);
};

/**
 * Register the given template engine callback `fn`
 * as `ext`.
 *
 * By default will `require()` the engine based on the
 * file extension. For example if you try to render
 * a "foo.ejs" file Express will invoke the following internally:
 *
 *     app.engine('ejs', require('ejs').__express);
 *
 * For engines that do not provide `.__express` out of the box,
 * or if you wish to "map" a different extension to the template engine
 * you may use this method. For example mapping the EJS template engine to
 * ".html" files:
 *
 *     app.engine('html', require('ejs').renderFile);
 *
 * In this case EJS provides a `.renderFile()` method with
 * the same signature that Express expects: `(path, options, callback)`,
 * though note that it aliases this method as `ejs.__express` internally
 * so if you're using ".ejs" extensions you don't need to do anything.
 *
 * Some template engines do not follow this convention, the
 * [Consolidate.js](https://github.com/tj/consolidate.js)
 * library was created to map all of node's popular template
 * engines to follow this convention, thus allowing them to
 * work seamlessly within Express.
 *
 * @param {String} ext
 * @param {Function} fn
 * @return {app} for chaining
 * @public
 */
// 注册模板引擎
app.engine = function engine(ext, fn) {
  /**
   * 如果 fn 不是函数，则抛出错误
   */
  if (typeof fn !== 'function') {
    throw new Error('callback function required');
  }
  // 获取文件扩展名
  var extension = ext[0] !== '.'
    ? '.' + ext
    : ext;

  // 存储引擎
  this.engines[extension] = fn;

  return this;
};

/**
 * Proxy to `Router#param()` with one added api feature. The _name_ parameter
 * can be an array of names.
 *
 * See the Router#param() docs for more details.
 *
 * @param {String|Array} name
 * @param {Function} fn
 * @return {app} for chaining
 * @public
 */
// 注册路由参数中间件
/**
 * 这个函数用于注册路由参数中间件 也就是我们用的 app.param('id',fn)
 * @param {*} name
 * @param {*} fn
 * @returns
 */
app.param = function param(name, fn) {
  this.lazyrouter();
  /**
   * 如果 name 是数组，则遍历数组并递归调用 param 方法
   */
  if (Array.isArray(name)) {
    for (var i = 0; i < name.length; i++) {
      this.param(name[i], fn);
    }

    return this;
  }
  /**
   * 将参数注册到路由器
   */
  this._router.param(name, fn);

  return this;
};

/**
 * Assign `setting` to `val`, or return `setting`'s value.
 *
 *    app.set('foo', 'bar');
 *    app.set('foo');
 *    // => "bar"
 *
 * Mounted servers inherit their parent server's settings.
 *
 * @param {String} setting
 * @param {*} [val]
 * @return {Server} for chaining
 * @public
 */
// 设置或获取应用配置
/**
 * @description 这个函数用于设置或获取应用配置
 * @param {*} setting 配置名
 * @param {*} val 配置值
 * @returns
 */
app.set = function set(setting, val) {
  /**
   * 如果只有一个参数，则获取配置
   */
  if (arguments.length === 1) {
    // app.get(setting)
    var settings = this.settings;
    /**
     * 遍历原型链，直到找到配置
     */
    while (settings && settings !== Object.prototype) {
      if (hasOwnProperty.call(settings, setting)) {
        return settings[setting];
      }

      settings = Object.getPrototypeOf(settings);
    }
    /**
     * 如果配置不存在，则返回 undefined
     */
    return undefined;
  }

  debug('set "%s" to %o', setting, val);

  // 设置值
  this.settings[setting] = val;

  // 触发匹配的设置
  switch (setting) {
    case 'etag':
      this.set('etag fn', compileETag(val));
      break;
    case 'query parser':
      this.set('query parser fn', compileQueryParser(val));
      break;
    case 'trust proxy':
      this.set('trust proxy fn', compileTrust(val));

      // 兼容旧版信任代理
      Object.defineProperty(this.settings, trustProxyDefaultSymbol, {
        configurable: true,
        value: false
      });

      break;
  }

  return this;
};

/**
 * Return the app's absolute pathname
 * based on the parent(s) that have
 * mounted it.
 *
 * For example if the application was
 * mounted as "/admin", which itself
 * was mounted as "/blog" then the
 * return value would be "/blog/admin".
 *
 * @return {String}
 * @private
 */
// 返回应用的绝对路径
app.path = function path() {
  return this.parent
    ? this.parent.path() + this.mountpath
    : '';
};

/**
 * Check if `setting` is enabled (truthy).
 *
 *    app.enabled('foo')
 *    // => false
 *
 *    app.enable('foo')
 *    app.enabled('foo')
 *    // => true
 *
 * @param {String} setting
 * @return {Boolean}
 * @public
 */
// 检查配置是否启用
app.enabled = function enabled(setting) {
  return Boolean(this.set(setting));
};

/**
 * Check if `setting` is disabled.
 *
 *    app.disabled('foo')
 *    // => true
 *
 *    app.enable('foo')
 *    app.disabled('foo')
 *    // => false
 *
 * @param {String} setting
 * @return {Boolean}
 * @public
 */
// 检查配置是否禁用
app.disabled = function disabled(setting) {
  return !this.set(setting);
};

/**
 * Enable `setting`.
 *
 * @param {String} setting
 * @return {app} for chaining
 * @public
 */
// 启用配置
app.enable = function enable(setting) {
  return this.set(setting, true);
};

/**
 * Disable `setting`.
 *
 * @param {String} setting
 * @return {app} for chaining
 * @public
 */
// 禁用配置
app.disable = function disable(setting) {
  return this.set(setting, false);
};

/**
 * Delegate `.VERB(...)` calls to `router.VERB(...)`.
 */
// 将 HTTP 方法代理到路由器
methods.forEach(function(method){
  app[method] = function(path){
    /**
     * 如果方法为 get 且只有一个参数，则获取配置
     */
    if (method === 'get' && arguments.length === 1) {
      // app.get(setting)
      return this.set(path);
    }
    /**
     * 延迟加载路由器
     */
    this.lazyrouter();
    /**
     * 获取路由
     */
    var route = this._router.route(path);
    /**
     * 调用路由方法
     */
    route[method].apply(route, slice.call(arguments, 1));
    return this;
  };
});

/**
 * Special-cased "all" method, applying the given route `path`,
 * middleware, and callback to _every_ HTTP method.
 *
 * @param {String} path
 * @param {Function} ...
 * @return {app} for chaining
 * @public
 */
// 特殊处理的 "all" 方法，应用于所有 HTTP 方法
app.all = function all(path) {
  this.lazyrouter();
  /**
   * 获取路由
   */
  var route = this._router.route(path);
  /**
   * 获取参数
   */
  var args = slice.call(arguments, 1);
  /**
   * 遍历 HTTP 方法
   */
  for (var i = 0; i < methods.length; i++) {
    /**
     * 调用路由方法
     */
    route[methods[i]].apply(route, args);
  }

  return this;
};

// del -> delete alias
// 删除方法的别名
app.del = deprecate.function(app.delete, 'app.del: Use app.delete instead');

/**
 * Render the given view `name` name with `options`
 * and a callback accepting an error and the
 * rendered template string.
 *
 * Example:
 *
 *    app.render('email', { name: 'Tobi' }, function(err, html){
 *      // ...
 *    })
 *
 * @param {String} name
 * @param {Object|Function} options or fn
 * @param {Function} callback
 * @public
 */
// 渲染视图
app.render = function render(name, options, callback) {
  /**
   * 获取缓存
   * 获取回调
   * 获取模板引擎
   * 获取选项
   */
  var cache = this.cache;
  var done = callback;
  var engines = this.engines;
  var opts = options;
  var renderOptions = {};
  var view;

  // 支持回调函数作为第二个参数
  /**
   * 如果 options 是一个函数， 说明是回调函数 done = options 将 options 设置为空对象
   */
  if (typeof options === 'function') {
    done = options;
    opts = {};
  }

  // 合并 app.locals
  merge(renderOptions, this.locals);

  // 合并 options._locals
  if (opts._locals) {
    merge(renderOptions, opts._locals);
  }

  // 合并 options
  merge(renderOptions, opts);

  // 设置 .cache 除非明确提供
  if (renderOptions.cache == null) {
    renderOptions.cache = this.enabled('view cache');
  }

  // 已缓存
  if (renderOptions.cache) {
    view = cache[name];
  }

  // 视图
  if (!view) {
    /**
     * 获取视图
     */
    var View = this.get('view');
    /**
     * 创建视图
     * root: 视图路径
     * defaultEngine: 默认模板引擎
     * engines: 模板引擎
     */
    view = new View(name, {
      defaultEngine: this.get('view engine'),
      root: this.get('views'),
      engines: engines
    });
    /**
     * 如果视图路径不存在，则抛出错误
     */
    if (!view.path) {
      /**
       * 获取视图路径
       */
      var dirs = Array.isArray(view.root) && view.root.length > 1
        ? 'directories "' + view.root.slice(0, -1).join('", "') + '" or "' + view.root[view.root.length - 1] + '"'
        : 'directory "' + view.root + '"';
      var err = new Error('Failed to lookup view "' + name + '" in views ' + dirs);
      err.view = view;
      return done(err);
    }

    // 缓存视图
    if (renderOptions.cache) {
      cache[name] = view;
    }
  }

  // 渲染
  tryRender(view, renderOptions, done);
};

/**
 * Listen for connections.
 *
 * A node `http.Server` is returned, with this
 * application (which is a `Function`) as its
 * callback. If you wish to create both an HTTP
 * and HTTPS server you may do so with the "http"
 * and "https" modules as shown here:
 *
 *    var http = require('http')
 *      , https = require('https')
 *      , express = require('express')
 *      , app = express();
 *
 *    http.createServer(app).listen(80);
 *    https.createServer({ ... }, app).listen(443);
 *
 * @return {http.Server}
 * @public
 */
// 监听连接
app.listen = function listen() {
  /**
   * 调用原生 http 模块创建服务器
   * 改变 this 的指向到 server 即app就是server
   */
  var server = http.createServer(this);
  return server.listen.apply(server, arguments);
};

/**
 * Log error using console.error.
 *
 * @param {Error} err
 * @private
 */
// 使用 console.error 记录错误
function logerror(err) {
  /* istanbul ignore next */
  if (this.get('env') !== 'test') console.error(err.stack || err.toString());
}

/**
 * Try rendering a view.
 * @private
 */
// 尝试渲染视图
function tryRender(view, options, callback) {
  try {
    view.render(options, callback);
  } catch (err) {
    callback(err);
  }
}
