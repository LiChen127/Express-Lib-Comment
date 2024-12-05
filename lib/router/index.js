/*!
 * express
 * Copyright(c) 2009-2013 TJ Holowaychuk
 * Copyright(c) 2013 Roman Shtylman
 * Copyright(c) 2014-2015 Douglas Christopher Wilson
 * MIT Licensed
 */

'use strict';
/**
 * 路由层
 * 1. 处理路由注册和匹配
 * 2. 管理路由中间件
 */
/**
 * Module dependencies.
 * @private
 */

var Route = require('./route');
var Layer = require('./layer');
var methods = require('methods');
var mixin = require('utils-merge');
var debug = require('debug')('express:router');
var deprecate = require('depd')('express');
var flatten = require('array-flatten');
var parseUrl = require('parseurl');
var setPrototypeOf = require('setprototypeof')

/**
 * Module variables.
 * @private
 */
/**
 * 对象正则
 * 获取私有属性
 */
var objectRegExp = /^\[object (\S+)\]$/;
var slice = Array.prototype.slice;
var toString = Object.prototype.toString;

/**
 * Initialize a new `Router` with the given `options`.
 *
 * @param {Object} [options]
 * @return {Router} which is a callable function
 * @public
 */
/**
 * 定义路由器原型
 * @param {Object} [options] 配置
 * @returns {Router} 路由器
 */
var proto = module.exports = function (options) {
  /**
   * 如果 options 不存在，则设置为空对象
   * 如果 options 存在，则使用 options
   */
  var opts = options || {};
  /**
   * 定义路由器
   * @param {Object} req 请求
   * @param {Object} res 响应
   * @param {Function} next 下一个中间件
   */
  function router(req, res, next) {
    router.handle(req, res, next);
  }
  /**
   * 设置原型
   */
  // mixin Router class functions
  setPrototypeOf(router, proto)
  /**
   * 初始化路由器参数
   */
  router.params = {};
  router._params = [];
  router.caseSensitive = opts.caseSensitive;
  router.mergeParams = opts.mergeParams;
  router.strict = opts.strict;
  router.stack = [];

  return router;
};

/**
 * Map the given param placeholder `name`(s) to the given callback.
 *
 * Parameter mapping is used to provide pre-conditions to routes
 * which use normalized placeholders. For example a _:user_id_ parameter
 * could automatically load a user's information from the database without
 * any additional code,
 *
 * The callback uses the same signature as middleware, the only difference
 * being that the value of the placeholder is passed, in this case the _id_
 * of the user. Once the `next()` function is invoked, just like middleware
 * it will continue on to execute the route, or subsequent parameter functions.
 *
 * Just like in middleware, you must either respond to the request or call next
 * to avoid stalling the request.
 *
 *  app.param('user_id', function(req, res, next, id){
 *    User.find(id, function(err, user){
 *      if (err) {
 *        return next(err);
 *      } else if (!user) {
 *        return next(new Error('failed to load user'));
 *      }
 *      req.user = user;
 *      next();
 *    });
 *  });
 *
 * @param {String} name
 * @param {Function} fn
 * @return {app} for chaining
 * @public
 */
/**
 * 注册参数中间件
 * @param {*} name
 * @param {*} fn
 * @returns
 */
proto.param = function param(name, fn) {
  // param logic
  /**
   * 如果 name 是函数，则将 name 添加到 _params 数组中
   */
  if (typeof name === 'function') {
    deprecate('router.param(fn): Refactor to use path params');
    this._params.push(name);
    return;
  }
  /**
   * 获取参数
   */
  // apply param functions
  var params = this._params;
  var len = params.length;
  var ret;
  /**
   * 如果 name 以 : 开头，则抛出警告
   */
  if (name[0] === ':') {
    deprecate('router.param(' + JSON.stringify(name) + ', fn): Use router.param(' + JSON.stringify(name.slice(1)) + ', fn) instead')
    name = name.slice(1)
  }
  /**
   * 遍历参数
   */
  for (var i = 0; i < len; ++i) {
    if (ret = params[i](name, fn)) {
      /**
       * 如果 ret 存在，则将 ret 赋值给 fn
       */
      fn = ret;
    }
  }
  /**
   * 如果 fn 不是函数，则抛出错误
   */
  // ensure we end up with a
  // middleware function
  if ('function' !== typeof fn) {
    throw new Error('invalid param() call for ' + name + ', got ' + fn);
  }
  /**
   * 将 fn 添加到 params 中
   */
  (this.params[name] = this.params[name] || []).push(fn);
  return this;
};

/**
 * Dispatch a req, res into the router.
 * @private
 */
/**
 * 处理请求
 * @param {*} req 请求
 * @param {*} res 响应
 * @param {*} out 输出
 */
proto.handle = function handle(req, res, out) {
  var self = this;

  debug('dispatching %s %s', req.method, req.url);
  /**
   * 初始化索引
   */
  var idx = 0;
  /**
   * 获取协议和主机
   */
  var protohost = getProtohost(req.url) || ''
  /**
   * 移除的路径
   */
  var removed = '';
  /**
   * 是否添加了斜杠
   */
  var slashAdded = false;
  /**
   * 同步计数
   */
  var sync = 0
  /**
   * 参数调用
   */
  var paramcalled = {};
  /**
   * 获取请求方法
   */
  var options = [];
  /**
   * 获取路由堆栈
   */
  // middleware and routes
  var stack = self.stack;
  /**
   * 获取父级参数
   */
  // manage inter-router variables
  /**
   * 获取父级参数
   */
  var parentParams = req.params;
  /**
   * 获取父级 URL
   */
  var parentUrl = req.baseUrl || '';
  /**
   * 获取最终处理器
   */
  var done = restore(out, req, 'baseUrl', 'next', 'params');
  /**
   * 设置 next
   */
  req.next = next;
  /**
   * 如果请求方法是 OPTIONS，则设置 done
   */
  if (req.method === 'OPTIONS') {
    done = wrap(done, function(old, err) {
      if (err || options.length === 0) return old(err);
      sendOptionsResponse(res, options, old);
    });
  }
  /**
   * 设置基本请求值
   */
  req.baseUrl = parentUrl;
  req.originalUrl = req.originalUrl || req.url;
  /**
   * 调用 next
   */
  next();
  /**
   * next 函数 是一个闭包
   */
  function next(err) {
    /**
     * 如果 err 是 route，则设置为 null
     */
    var layerError = err === 'route'
      ? null
      : err;
    /**
     * 如果添加了斜杠，则移除
     */
    if (slashAdded) {
      req.url = req.url.slice(1)
      slashAdded = false;
    }
    /**
     * 如果 removed 长度不为 0，则设置 req.baseUrl
     */
    if (removed.length !== 0) {
      req.baseUrl = parentUrl;
      req.url = protohost + removed + req.url.slice(protohost.length)
      removed = '';
    }
    /**
     * 如果 layerError 是 router，则设置为 null
     */
    if (layerError === 'router') {
      setImmediate(done, null)
      return
    }
    /**
     * 如果 idx 大于等于 stack 长度，则设置 done
     */
    if (idx >= stack.length) {
      setImmediate(done, layerError);
      return;
    }
    /**
     * 如果 sync 大于 100，则设置 done
     */
    if (++sync > 100) {
      return setImmediate(next, err)
    }
    /**
     * 获取请求路径
     */
    var path = getPathname(req);
    /**
     * 如果 path 为 null，则设置 done
     */
    if (path == null) {
      return done(layerError);
    }
    /**
     * 查找下一个匹配的层
     */
    var layer;
    var match;
    var route;
    /**
     * 遍历堆栈
     */
    while (match !== true && idx < stack.length) {
      /**
       * 获取层
       */
      layer = stack[idx++];
      /**
       * 匹配层
       */
      match = matchLayer(layer, path);
      /**
       * 获取路由
       */
      route = layer.route;
      /**
       * 如果 match 不是布尔值，则设置 layerError
       */
      if (typeof match !== 'boolean') {
        // hold on to layerError
        layerError = layerError || match;
      }
      /**
       * 如果 match 不是布尔值，则继续
       */
      if (match !== true) {
        continue;
      }

      if (!route) {
        // process non-route handlers normally
        continue;
      }
      /**
       * 如果 layerError 存在，则设置 match 为 false
       */
      if (layerError) {
        // routes do not match with a pending error
        match = false;
        continue;
      }
      /**
       * 获取请求方法
       */
      var method = req.method;
      /**
       * 获取请求方法
       */
      var has_method = route._handles_method(method);
      /**
       * 如果请求方法没有匹配，并且请求方法是 OPTIONS，则添加请求方法
       */
      if (!has_method && method === 'OPTIONS') {
        appendMethods(options, route._options());
      }
      /**
       * 如果请求方法没有匹配，并且请求方法不是 HEAD，则设置 match 为 false
       */
      if (!has_method && method !== 'HEAD') {
        match = false;
      }
    }
    /**
     * 如果 match 不是布尔值，则设置 done
     */
    if (match !== true) {
      return done(layerError);
    }
    /**
     * 如果 route 存在，则设置 req.route
     */
    if (route) {
      req.route = route;
    }
    /**
     * 设置 req.params
     */
    req.params = self.mergeParams
      ? mergeParams(layer.params, parentParams)
      : layer.params;
    var layerPath = layer.path;
    /**
     * 处理参数
     */
    self.process_params(layer, paramcalled, req, res, function (err) {
      /**
       * 如果 err 存在，则设置 next
       */
      if (err) {
        next(layerError || err)
      } else if (route) {
        /**
         * 处理请求
         */
        layer.handle_request(req, res, next)
      } else {
        /**
         * 处理前缀
         */
        trim_prefix(layer, layerError, layerPath, path)
      }
      /**
       * 重置 sync
       */
      sync = 0
    });
  }
  /**
   * 处理前缀
   * @param {*} layer 层
   * @param {*} layerError 层错误
   * @param {*} layerPath 层路径
   * @param {*} path 路径
   */
  function trim_prefix(layer, layerError, layerPath, path) {
    /**
     * 如果 layerPath 长度不为 0，则验证路径是否是前缀匹配
     */
    if (layerPath.length !== 0) {
      // Validate path is a prefix match
      /**
       * 如果 layerPath 不是 path 的前缀，则设置 next
       */
      if (layerPath !== path.slice(0, layerPath.length)) {
        next(layerError)
        return
      }
      /**
       * 获取路径的下一个字符
       */
      var c = path[layerPath.length]
      /**
       * 如果 c 存在，并且 c 不是 / 或 .，则设置 next
       */
      if (c && c !== '/' && c !== '.') return next(layerError)
      /**
       * 设置 removed
       */
      removed = layerPath;
      /**
       * 设置 req.url
       */
      req.url = protohost + req.url.slice(protohost.length + removed.length)
      /**
       * 如果 protohost 不存在，并且 req.url 的第一个字符不是 /，则设置 req.url
       */
      if (!protohost && req.url[0] !== '/') {
        req.url = '/' + req.url;
        slashAdded = true;
      }
      /**
       * 设置 req.baseUrl
       */
      req.baseUrl = parentUrl + (removed[removed.length - 1] === '/'
        ? removed.substring(0, removed.length - 1)
        : removed);
    }

    debug('%s %s : %s', layer.name, layerPath, req.originalUrl);
    /**
     * 如果 layerError 存在，则处理错误
     */
    if (layerError) {
      layer.handle_error(layerError, req, res, next);
    } else {
      /**
       * 处理请求
       */
      layer.handle_request(req, res, next);
    }
  }
};

/**
 * Process any parameters for the layer.
 * @private
 */
/**
 * 处理参数
 * @param {*} layer 层
 * @param {*} called 调用
 * @param {*} req 请求
 * @param {*} res 响应
 * @param {*} done 完成
 */
proto.process_params = function process_params(layer, called, req, res, done) {
  var params = this.params;
  /**
   * 获取参数
   */
  var keys = layer.keys;
  /**
   * 如果 keys 不存在，或者 keys 长度为 0，则设置 done
   */
  if (!keys || keys.length === 0) {
    return done();
  }
  /**
   * 设置 i
   */
  var i = 0;
  /**
   * 设置 name
   */
  var name;
  /**
   * 设置 paramIndex
   */
  var paramIndex = 0;
  /**
   * 设置 key
   */
  var key;
  /**
   * 设置 paramVal
   */
  var paramVal;
  /**
   * 设置 paramCallbacks
   */
  var paramCallbacks;

  // process params in order
  // param callbacks can be async
  /**
   * 处理参数
   * @param {*} err 错误
   * @returns
   */
  function param(err) {
    if (err) {
      /**
       * 如果 err 存在，则设置 done
       */
      return done(err);
    }
    /**
     * 如果 i 大于等于 keys 长度，则设置 done
     */
    if (i >= keys.length ) {
      return done();
    }
    /**
     * 设置 paramIndex
     */
    paramIndex = 0;
    /**
     * 设置 key
     */
    key = keys[i++];
    /**
     * 设置 name
     */
    name = key.name;
    /**
     * 设置 paramVal
     */
    paramVal = req.params[name];
    /**
     * 设置 paramCallbacks
     */
    paramCallbacks = params[name];
    /**
     * 设置 paramCalled
     */
    paramCalled = called[name];
    /**
     * 如果 paramVal 不存在，或者 paramCallbacks 不存在，则设置 done
     */
    if (paramVal === undefined || !paramCallbacks) {
      return param();
    }
    /**
     * 如果 paramCalled 存在，并且 paramCalled.match 等于 paramVal，或者 paramCalled.error 存在，并且 paramCalled.error 不等于 route，则设置 done
     */
    if (paramCalled && (paramCalled.match === paramVal
      || (paramCalled.error && paramCalled.error !== 'route'))) {
      // restore value
      req.params[name] = paramCalled.value;

      // next param
      return param(paramCalled.error);
    }
    /**
     * 设置 called
     */
    called[name] = paramCalled = {
      error: null,
      match: paramVal,
      value: paramVal
    };
    /**
     * 处理参数回调
     */
    paramCallback();
  }
  /**
   * 处理参数回调
   * @param {*} err 错误
   * @returns
   */
  // single param callbacks
  function paramCallback(err) {
    /**
     * 获取参数回调
     */
    var fn = paramCallbacks[paramIndex++];
    /**
     * 设置 paramCalled.value
     */
    paramCalled.value = req.params[key.name];

    if (err) {
      // store error
      paramCalled.error = err;
      param(err);
      return;
    }
    /**
     * 如果 fn 不存在，则设置 done
     */
    if (!fn) return param();

    try {
      /**
       * 处理参数回调
       */
      fn(req, res, paramCallback, paramVal, key.name);
    } catch (e) {
      paramCallback(e);
    }
  }
  /**
   * 处理参数
   */
  param();
};

/**
 * Use the given middleware function, with optional path, defaulting to "/".
 *
 * Use (like `.all`) will run for any http METHOD, but it will not add
 * handlers for those methods so OPTIONS requests will not consider `.use`
 * functions even if they could respond.
 *
 * The other difference is that _route_ path is stripped and not visible
 * to the handler function. The main effect of this feature is that mounted
 * handlers can operate without any code changes regardless of the "prefix"
 * pathname.
 *
 * @public
 */
/**
 * 使用给定的中间件函数，带有可选的路径，默认为 "/"
 * @param {*} fn 中间件函数
 * @returns
 */
proto.use = function use(fn) {
  var offset = 0;
  var path = '/';

  // default path to '/'
  // disambiguate router.use([fn])
  /**
   * 如果 fn 不是函数，则处理参数
   */
  if (typeof fn !== 'function') {
    var arg = fn;

    while (Array.isArray(arg) && arg.length !== 0) {
      arg = arg[0];
    }

    // first arg is the path
    if (typeof arg !== 'function') {
      offset = 1;
      path = fn;
    }
  }
  /**
   * 获取中间件函数
   * 扁平化
   */
  var callbacks = flatten(slice.call(arguments, offset));
  /**
   * 如果 callbacks 长度为 0，则抛出错误
   */
  if (callbacks.length === 0) {
    throw new TypeError('Router.use() requires a middleware function')
  }
  /**
   * 遍历中间件函数
   */
  for (var i = 0; i < callbacks.length; i++) {
    /**
     * 设置回调
     */
    var fn = callbacks[i];
    /**
     * 如果 fn 不是函数，则抛出错误
     */
    if (typeof fn !== 'function') {
      throw new TypeError('Router.use() requires a middleware function but got a ' + gettype(fn))
    }
    /**
     * 调试
     */
    debug('use %o %s', path, fn.name || '<anonymous>')
    /**
     * 创建层
     */
    var layer = new Layer(path, {
      sensitive: this.caseSensitive,
      strict: false,
      end: false
    }, fn);
    /**
     * 设置 layer.route 为 undefined
     */
    layer.route = undefined;
    /**
     * 将层添加到堆栈中
     */
    this.stack.push(layer);
  }

  return this;
};

/**
 * Create a new Route for the given path.
 *
 * Each route contains a separate middleware stack and VERB handlers.
 *
 * See the Route api documentation for details on adding handlers
 * and middleware to routes.
 *
 * @param {String} path
 * @return {Route}
 * @public
 */
/**
 * 创建一个给定路径的新路由
 * @param {*} path 路径
 * @returns
 */
proto.route = function route(path) {
  /**
   * 创建路由
   */
  var route = new Route(path);
  /**
   * 创建层
   */
  var layer = new Layer(path, {
    sensitive: this.caseSensitive,
    strict: this.strict,
    end: true
  }, route.dispatch.bind(route));

  layer.route = route;

  this.stack.push(layer);
  return route;
};

// create Router#VERB functions
/**
 * 创建 Router#VERB 函数
 */
methods.concat('all').forEach(function(method){
  proto[method] = function(path){
    /**
     * 创建路由
     */
    var route = this.route(path)
    /**
     * 调用路由方法
     */
    route[method].apply(route, slice.call(arguments, 1));
    return this;
  };
});

// append methods to a list of methods
/**
 * 追加方法到方法列表
 * @param {*} list 方法列表
 * @param {*} addition 添加的方法
 */
function appendMethods(list, addition) {
  /**
   * 遍历要添加的方法
   */
  for (var i = 0; i < addition.length; i++) {
    var method = addition[i];
    if (list.indexOf(method) === -1) {
      /**
       * 如果方法不存在，则添加到方法列表中
       */
      list.push(method);
    }
  }
}
/**
 * 获取请求的路径名
 * @param {*} req 请求
 * @returns
 */
// get pathname of request
function getPathname(req) {
  try {
    /**
     * 解析请求
     */
    return parseUrl(req).pathname;
  } catch (err) {
    return undefined;
  }
}
/**
 * 获取 URL 的协议和主机
 * @param {*} url URL
 * @returns
 */
// Get get protocol + host for a URL
function getProtohost(url) {
  /**
   * 如果url不合法返回undefined
   */
  if (typeof url !== 'string' || url.length === 0 || url[0] === '/') {
    return undefined
  }
  /**
   * 使用?解析query
   */
  var searchIndex = url.indexOf('?')
  /**
   * 设置 pathLength
   */
  var pathLength = searchIndex !== -1
    ? searchIndex
    : url.length
  /**
   * 设置 fqdnIndex
   */
  var fqdnIndex = url.slice(0, pathLength).indexOf('://')
  /**
   * 如果 fqdnIndex 不等于 -1，则返回 url 的子字符串
   */
  return fqdnIndex !== -1
    ? url.substring(0, url.indexOf('/', 3 + fqdnIndex))
    : undefined
}
/**
 * 获取错误消息的类型
 * @param {*} obj 对象
 * @returns
 */
// get type for error message
function gettype(obj) {
  var type = typeof obj;

  if (type !== 'object') {
    return type;
  }

  // inspect [[Class]] for objects
  return toString.call(obj)
    .replace(objectRegExp, '$1');
}

/**
 * Match path to a layer.
 *
 * @param {Layer} layer
 * @param {string} path
 * @private
 */
/**
 * 匹配路径到层
 * @param {*} layer 层
 * @param {*} path 路径
 * @returns
 */
function matchLayer(layer, path) {
  try {
    return layer.match(path);
  } catch (err) {
    return err;
  }
}
/**
 * 合并参数
 * @param {*} params 参数
 * @param {*} parent 父级
 * @returns
 */
// merge params with parent params
function mergeParams(params, parent) {
  /**
   * 如果 parent 不是对象或不存在，则返回 params
   */
  if (typeof parent !== 'object' || !parent) {
    return params;
  }
 /**
  * 混入 parent 到 obj
  */
  // make copy of parent for base
  var obj = mixin({}, parent);
  /**
   * 如果 params 不是对象或不存在，则返回 obj
   */
  // simple non-numeric merging
  if (!(0 in params) || !(0 in parent)) {
    return mixin(obj, params);
  }
  /**
   * 设置 i 和 o
   */
  var i = 0;
  var o = 0;
  /**
   * 确定数字间隙
   */
  while (i in params) {
    i++;
  }
  /**
   * 确定数字间隙
   */
  while (o in parent) {
    o++;
  }
  /**
   * 偏移数字索引
   */
  for (i--; i >= 0; i--) {
    params[i + o] = params[i];
    /**
     * 当必要时创建空洞
     */
    if (i < o) {
      delete params[i];
    }
  }
  /**
   * 混入 params 到 obj
   */
  return mixin(obj, params);
}
/**
 * 恢复 obj 的 props 后函数
 * @param {*} fn 函数
 * @param {*} obj 对象
 * @returns
 */
// restore obj props after function
function restore(fn, obj) {
  /**
   * 设置 props 和 vals
   */
  var props = new Array(arguments.length - 2);
  var vals = new Array(arguments.length - 2);
  /**
   * 遍历 props
   */
  for (var i = 0; i < props.length; i++) {
    props[i] = arguments[i + 2];
    vals[i] = obj[props[i]];
  }

  return function () {
    /**
     * 遍历 props
     * 将 vals 恢复到 obj
     */
    // restore vals
    for (var i = 0; i < props.length; i++) {
      obj[props[i]] = vals[i];
    }
    /**
     * 返回函数将this和arguments传递给fn
     */
    return fn.apply(this, arguments);
  };
}
/**
 * 发送一个 OPTIONS 响应
 * @param {*} res 响应
 * @param {*} options 选项
 * @param {*} next 下一个
 */
// send an OPTIONS response
function sendOptionsResponse(res, options, next) {
  try {
    var body = options.join(',');
    res.set('Allow', body);
    res.send(body);
  } catch (err) {
    next(err);
  }
}
/**
 * 包装一个函数
 * @param {*} old 旧的
 * @param {*} fn 函数
 * @returns
 */
// wrap a function
function wrap(old, fn) {
  /**
   * 代理
   */
  return function proxy() {
    var args = new Array(arguments.length + 1);
    /**
     * 设置 args[0]
     */
    args[0] = old;
    /**
     * 遍历 arguments
     */
    for (var i = 0, len = arguments.length; i < len; i++) {
      args[i + 1] = arguments[i];
    }
    /**
     * 返回函数将this和args传递给fn
     */
    fn.apply(this, args);
  };
}
