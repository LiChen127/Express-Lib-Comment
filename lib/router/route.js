/*!
 * express
 * Copyright(c) 2009-2013 TJ Holowaychuk
 * Copyright(c) 2013 Roman Shtylman
 * Copyright(c) 2014-2015 Douglas Christopher Wilson
 * MIT Licensed
 */

'use strict';
/**
 * Route类
 * 负责处理路由
 * 路由和路由层的区别是: 路由层是中间件，路由是路由层的一个实例
 */
/**
 * Module dependencies.
 * @private
 */
/**
 * 调试
 */
var debug = require('debug')('express:router:route');
/**
 * 扁平化数组
 */
var flatten = require('array-flatten');
var Layer = require('./layer');
/**
 * 方法
 */
var methods = require('methods');

/**
 * Module variables.
 * @private
 */
/**
 * 数组切片
 */
var slice = Array.prototype.slice;
var toString = Object.prototype.toString;

/**
 * Module exports.
 * @public
 */
/**
 * 导出 Route 类
 */
module.exports = Route;

/**
 * Initialize `Route` with the given `path`,
 *
 * @param {String} path
 * @public
 */
/**
 * 初始化 Route
 * @param {*} path 路径
 */
function Route(path) {
  /**
   * 设置 path
   */
  this.path = path;
  /**
   * 设置 stack
   */
  this.stack = [];

  debug('new %o', path);
  /**
   * 设置 methods
   */
  this.methods = {};
}

/**
 * Determine if the route handles a given method.
 * @private
 */
/**
 * 判断路由是否处理给定的方法
 * @param {*} method 方法
 * @returns
 */
Route.prototype._handles_method = function _handles_method(method) {
  if (this.methods._all) {
    return true;
  }
  /**
   * 规范化方法名
   */
  var name = typeof method === 'string'
    ? method.toLowerCase()
    : method

  if (name === 'head' && !this.methods['head']) {
    name = 'get';
  }

  return Boolean(this.methods[name]);
};

/**
 * @return {Array} supported HTTP methods
 * @private
 */
/**
 * 获取支持的 HTTP 方法
 * @returns
 */
Route.prototype._options = function _options() {
  /**
   * 获取key
   */
  var methods = Object.keys(this.methods);
  /**
   * 如果支持 get 方法，但 不支持 head 方法
   */
  // append automatic head
  if (this.methods.get && !this.methods.head) {
    methods.push('head');
  }
  /**
   * 遍历 methods
   */
  for (var i = 0; i < methods.length; i++) {
    /**
     * 将方法名转换为大写
     */
    methods[i] = methods[i].toUpperCase();
  }

  return methods;
};

/**
 * dispatch req, res into this route
 * @private
 */
/**
 * 调度请求
 * @param {*} req 请求
 * @param {*} res 响应
 * @param {*} done 完成
 * @returns
 */
Route.prototype.dispatch = function dispatch(req, res, done) {
  /**
   * 初始化索引
   */
  var idx = 0;
  /**
   * 获取到堆栈的引用
   */
  var stack = this.stack;
  /**
   * 同步计数器
   */
  var sync = 0;
  /**
   * 如果堆栈为空
   */
  if (stack.length === 0) {
    /**
     * 调用 done
     */
    return done();
  }
  /**
   * 获取请求方法
   */
  var method = typeof req.method === 'string'
    ? req.method.toLowerCase()
    : req.method;
  /**
   * 如果请求方法是 head 且不支持 head 方法
   */
  if (method === 'head' && !this.methods['head']) {
    method = 'get';
  }
  /**
   * 设置请求的路由
   */
  req.route = this;
  /**
   * 调用 next
   */
  next();

  function next(err) {
    /**
     * 信号退出路由
     */
    // signal to exit route
    if (err && err === 'route') {
      return done();
    }
    /**
     * 信号退出路由
     */
    if (err && err === 'router') {
      return done(err)
    }
    /**
     * 如果同步计数器大于 100
     */
    if (++sync > 100) {
      return setImmediate(next, err)
    }
    /**
     * 获取层
     */
    var layer = stack[idx++];
    /**
     * 如果层为空
     */
    if (!layer) {
      return done(err);
    }
    /**
     * 如果层的方法和请求方法不匹配
     */
    if (layer.method && layer.method !== method) {
      next(err)
    } else if (err) {
      layer.handle_error(err, req, res, next);
    } else {
      /**
       * 处理请求
       */
      layer.handle_request(req, res, next);
    }

    sync = 0
  }
};

/**
 * Add a handler for all HTTP verbs to this route.
 *
 * Behaves just like middleware and can respond or call `next`
 * to continue processing.
 *
 * You can use multiple `.all` call to add multiple handlers.
 *
 *   function check_something(req, res, next){
 *     next();
 *   };
 *
 *   function validate_user(req, res, next){
 *     next();
 *   };
 *
 *   route
 *   .all(validate_user)
 *   .all(check_something)
 *   .get(function(req, res, next){
 *     res.send('hello world');
 *   });
 *
 * @param {function} handler
 * @return {Route} for chaining
 * @api public
 */
/**
 * 添加一个处理程序到所有 HTTP 方法的路由
 * @returns
 */
Route.prototype.all = function all() {
  /**
   * 扁平化参数
   */
  var handles = flatten(slice.call(arguments));
  /**
   * 遍历 handles
   */
  for (var i = 0; i < handles.length; i++) {
    var handle = handles[i];

    if (typeof handle !== 'function') {
      var type = toString.call(handle);
      var msg = 'Route.all() requires a callback function but got a ' + type
      throw new TypeError(msg);
    }
    /**
     * 创建层
     */
    var layer = Layer('/', {}, handle);
    /**
     * 设置方法
     */
    layer.method = undefined;

    this.methods._all = true;
    this.stack.push(layer);
  }

  return this;
};
/**
 * 遍历方法
 */
methods.forEach(function (method) {
  /**
   * 设置方法
   * @returns
   */
  Route.prototype[method] = function () {
    /**
     * 扁平化参数
     */
    var handles = flatten(slice.call(arguments));
    /**
     * 遍历 handles
     */
    for (var i = 0; i < handles.length; i++) {
      var handle = handles[i];

      if (typeof handle !== 'function') {
        var type = toString.call(handle);
        var msg = 'Route.' + method + '() requires a callback function but got a ' + type
        throw new Error(msg);
      }

      debug('%s %o', method, this.path);
      /**
       * 创建层
       */
      var layer = Layer('/', {}, handle);
      layer.method = method;

      this.methods[method] = true;
      this.stack.push(layer);
    }

    return this;
  };
});
