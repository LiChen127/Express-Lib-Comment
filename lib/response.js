/*!
 * express
 * Copyright(c) 2009-2013 TJ Holowaychuk
 * Copyright(c) 2014-2015 Douglas Christopher Wilson
 * MIT Licensed
 */

'use strict';

/**
 * Module dependencies.
 * @private
 */

var Buffer = require('safe-buffer').Buffer
var contentDisposition = require('content-disposition');
var createError = require('http-errors')
var deprecate = require('depd')('express');
var encodeUrl = require('encodeurl');
var escapeHtml = require('escape-html');
var http = require('http');
var isAbsolute = require('./utils').isAbsolute;
var onFinished = require('on-finished');
var path = require('path');
var statuses = require('statuses')
var merge = require('utils-merge');
var sign = require('cookie-signature').sign;
var normalizeType = require('./utils').normalizeType;
var normalizeTypes = require('./utils').normalizeTypes;
var setCharset = require('./utils').setCharset;
var cookie = require('cookie');
var send = require('send');
var extname = path.extname;
var mime = send.mime;
var resolve = path.resolve;
var vary = require('vary');

/**
 * Response prototype.
 * @public
 */

var res = Object.create(http.ServerResponse.prototype)

/**
 * Module exports.
 * @public
 */

module.exports = res

/**
 * Module variables.
 * @private
 */
/**
 * 字符集正则
 */
var charsetRegExp = /;\s*charset\s*=/;

/**
 * 设置状态码
 *
 * @param {Number} code
 * @return {ServerResponse}
 * @public
 */

res.status = function status(code) {
  /**
   * 如果 code 是字符串或小数 且 在 100-999 之间
   * 则发出弃用警告
   */
  if ((typeof code === 'string' || Math.floor(code) !== code) && code > 99 && code < 1000) {
    deprecate('res.status(' + JSON.stringify(code) + '): use res.status(' + Math.floor(code) + ') instead')
  }
  /**
   * 设置状态码
   */
  this.statusCode = code;
  return this;
};

/**
 * 设置 Link 头字段
 *
 * 示例：
 *
 *    res.links({
 *      next: 'http://api.example.com/users?page=2',
 *      last: 'http://api.example.com/users?page=5'
 *    });
 *
 * @param {Object} links
 * @return {ServerResponse}
 * @public
 */

res.links = function (links) {
  /**
   * 获取 Link 头字段
   */
  var link = this.get('Link') || '';
  /**
   * 如果 Link 头字段存在 则添加逗号
   */
  if (link) link += ', ';
  /**
   * 设置 Link 头字段
   */
  return this.set('Link', link + Object.keys(links).map(function(rel){
    return '<' + links[rel] + '>; rel="' + rel + '"';
  }).join(', '));
};

/**
 * 发送响应
 *
 * 示例：
 *
 *     res.send(Buffer.from('wahoo'));
 *     res.send({ some: 'json' });
 *     res.send('<p>some html</p>');
 *
 * @param {string|number|boolean|object|Buffer} body
 * @public
 */

res.send = function send(body) {
  /**
   * 设置响应体
   */
  var chunk = body;
  /**
   * 字符编码
   */
  var encoding;
  /**
   * 请求对象
   */
  var req = this.req;
  /**
   * 类型
   */
  var type;
  /**
   * 应用对象
   */
  var app = this.app;
  /**
   * 如果参数长度为 2
   */
  if (arguments.length === 2) {
    /**
     * res.send(body, status) 兼容
     */
    // res.send(body, status) backwards compat
    if (typeof arguments[0] !== 'number' && typeof arguments[1] === 'number') {
      deprecate('res.send(body, status): Use res.status(status).send(body) instead');
      this.statusCode = arguments[1];
    } else {
      deprecate('res.send(status, body): Use res.status(status).send(body) instead');
      this.statusCode = arguments[0];
      chunk = arguments[1];
    }
  }
  /**
   * 如果参数是数字 且 参数长度为 1
   */
  if (typeof chunk === 'number' && arguments.length === 1) {
    /**
     * res.send(status) 将设置状态消息为文本字符串
     */
    if (!this.get('Content-Type')) {
      this.type('txt');
    }
    /**
     * 发出弃用警告
     */
    deprecate('res.send(status): Use res.sendStatus(status) instead');
    /**
     * 设置状态码
     */
    this.statusCode = chunk;
    /**
     * 设置响应体
     */
    chunk = statuses.message[chunk]
  }

  switch (typeof chunk) {
    // string defaulting to html
    case 'string':
      /**
       * 如果 Content-Type 头字段不存在
       * 则设置为 html
       */
      if (!this.get('Content-Type')) {
        this.type('html');
      }
      break;
    case 'boolean':
    case 'number':
    case 'object':
      /**
       * 如果 chunk 为 null
       * 则设置为空字符串
       */
      if (chunk === null) {
        chunk = '';
      } else if (Buffer.isBuffer(chunk)) {
        /**
         * 如果 chunk 是 Buffer 对象
         * 则设置为 bin
         */
        if (!this.get('Content-Type')) {
          this.type('bin');
        }
      } else {
        /**
         * 否则 返回 JSON 响应
         */
        return this.json(chunk);
      }
      break;
  }

  /**
   * 如果 chunk 是字符串
   */
  if (typeof chunk === 'string') {
    encoding = 'utf8';
    type = this.get('Content-Type');
    /**
     * 如果 type 是字符串
     * 则设置为 utf-8
     */
    if (typeof type === 'string') {
      this.set('Content-Type', setCharset(type, 'utf-8'));
    }
  }

  /**
   * 确定是否生成 ETag
   */
  var etagFn = app.get('etag fn')
  var generateETag = !this.get('ETag') && typeof etagFn === 'function'

  /**
   * 设置 Content-Length
   */
  var len
  if (chunk !== undefined) {
    if (Buffer.isBuffer(chunk)) {
      /**
       * 如果 chunk 是 Buffer 对象
       * 则获取长度
       */
      len = chunk.length
    } else if (!generateETag && chunk.length < 1000) {
      /**
       * 如果 chunk 长度小于 1000
       * 则计算长度
       */
      len = Buffer.byteLength(chunk, encoding)
    } else {
      /**
       * 否则 将 chunk 转换为 Buffer 对象 并计算长度
       */
      chunk = Buffer.from(chunk, encoding)
      encoding = undefined;
      len = chunk.length
    }

    this.set('Content-Length', len);
  }

  /**
   * 如果 generateETag 为 true 且 len 不为 undefined
   */
  var etag;
  if (generateETag && len !== undefined) {
    if ((etag = etagFn(chunk, encoding))) {
      this.set('ETag', etag);
    }
  }

  /**
   * 如果请求是新鲜的
   * 则设置状态码为 304
   */
  if (req.fresh) this.statusCode = 304;

  /**
   * 如果状态码为 204 或 304
   * 则移除 Content-Type 和 Content-Length 头字段
   */
  if (204 === this.statusCode || 304 === this.statusCode) {
    this.removeHeader('Content-Type');
    this.removeHeader('Content-Length');
    this.removeHeader('Transfer-Encoding');
    chunk = '';
  }

  /**
   * 如果状态码为 205
   * 则设置 Content-Length 为 0
   */
  if (this.statusCode === 205) {
    this.set('Content-Length', '0')
    this.removeHeader('Transfer-Encoding')
    chunk = ''
  }

  if (req.method === 'HEAD') {
    /**
     * 如果请求方法是 HEAD
     * 则跳过响应体
     */
    this.end();
  } else {
    /**
     * 否则 结束响应
     */
    this.end(chunk, encoding);
  }

  return this;
};

/**
 * Send JSON response.
 *
 * Examples:
 *
 *     res.json(null);
 *     res.json({ user: 'tj' });
 *
 * @param {string|number|boolean|object} obj
 * @public
 */

res.json = function json(obj) {
  var val = obj;

  /**
   * 如果参数长度为 2
   */
  if (arguments.length === 2) {
    /**
     * res.json(body, status) 兼容
     */
    if (typeof arguments[1] === 'number') {
      deprecate('res.json(obj, status): Use res.status(status).json(obj) instead');
      this.statusCode = arguments[1];
    } else {
      deprecate('res.json(status, obj): Use res.status(status).json(obj) instead');
      this.statusCode = arguments[0];
      val = arguments[1];
    }
  }

  /**
   * 设置应用对象
   */
  var app = this.app;
  /**
   * 设置 escape
   */
  var escape = app.get('json escape')
  var replacer = app.get('json replacer');
  var spaces = app.get('json spaces');
  var body = stringify(val, replacer, spaces, escape)

  /**
   * 如果 Content-Type 头字段不存在
   * 则设置为 application/json
   */
  if (!this.get('Content-Type')) {
    this.set('Content-Type', 'application/json');
  }

  return this.send(body);
};

/**
 * Send JSON response with JSONP callback support.
 *
 * Examples:
 *
 *     res.jsonp(null);
 *     res.jsonp({ user: 'tj' });
 *
 * @param {string|number|boolean|object} obj
 * @public
 */

res.jsonp = function jsonp(obj) {
  var val = obj;

  /**
   * 如果参数长度为 2
   */
  if (arguments.length === 2) {
    /**
     * res.jsonp(body, status) 兼容
     */
    if (typeof arguments[1] === 'number') {
      deprecate('res.jsonp(obj, status): Use res.status(status).jsonp(obj) instead');
      this.statusCode = arguments[1];
    } else {
      deprecate('res.jsonp(status, obj): Use res.status(status).jsonp(obj) instead');
      this.statusCode = arguments[0];
      val = arguments[1];
    }
  }

  /**
   * 设置应用对象
   */
  var app = this.app;
  /**
   * 设置 escape
   */
  var escape = app.get('json escape')
  /**
   * 设置 replacer
   */
  var replacer = app.get('json replacer');
  /**
   * 设置 spaces
   */
  var spaces = app.get('json spaces');
  /**
   * 设置 body
   */
  var body = stringify(val, replacer, spaces, escape)
  /**
   * 设置 callback
   */
  var callback = this.req.query[app.get('jsonp callback name')];

  /**
   * 如果 Content-Type 头字段不存在
   * 则设置为 application/json
   */
  if (!this.get('Content-Type')) {
    this.set('X-Content-Type-Options', 'nosniff');
    this.set('Content-Type', 'application/json');
  }

  /**
   * 如果 callback 是数组
   */
  if (Array.isArray(callback)) {
    callback = callback[0];
  }

  /**
   * 如果 callback 是字符串 且 长度不为 0
   */
  if (typeof callback === 'string' && callback.length !== 0) {
    this.set('X-Content-Type-Options', 'nosniff');
    this.set('Content-Type', 'text/javascript');

    /**
     * 限制 callback 字符集
     */
    callback = callback.replace(/[^\[\]\w$.]/g, '');

    if (body === undefined) {
      /**
       * 如果 body 为 undefined
       * 则设置为空字符串
       */
      body = ''
    } else if (typeof body === 'string') {
      /**
       * 如果 body 是字符串
       * 则替换不允许在 JavaScript 中使用的字符
       */
      body = body
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029')
    }

    /**
     * 设置 body
     */
    body = '/**/ typeof ' + callback + ' === \'function\' && ' + callback + '(' + body + ');';
  }

  return this.send(body);
};

/**
* Send given HTTP status code.
 *
 * Sets the response status to `statusCode` and the body of the
 * response to the standard description from node's http.STATUS_CODES
 * or the statusCode number if no description.
 *
 * Examples:
 *
 *     res.sendStatus(200);
 *
 * @param {number} statusCode
 * @public
 */

res.sendStatus = function sendStatus(statusCode) {
  /**
   * 设置 body
   */
  var body = statuses.message[statusCode] || String(statusCode)
  /**
   * 设置状态码
   */
  this.statusCode = statusCode;
  /**
   * 设置 Content-Type 为 text/plain
   */
  this.type('txt');

  return this.send(body);
};

/**
 * 传输给定的 `path` 文件。
 *
 * 自动设置 _Content-Type_ 响应头字段。
 * 回调函数 `callback(err)` 在传输完成或发生错误时被调用。
 * 请检查 `res.headersSent`，如果希望尝试响应，因为头和一些数据
 * 可能已经传输。
 *
 * 选项:
 *
 *   - `maxAge`   defaulting to 0 (can be string converted by `ms`)
 *   - `root`     root directory for relative filenames
 *   - `headers`  object of headers to serve with file
 *   - `dotfiles` serve dotfiles, defaulting to false; can be `"allow"` to send them
 *
 * 其他选项传递给 `send`。
 *
 * 示例:
 *
 * 以下示例说明了如何 `res.sendFile()` 可以
 * 用作 `static()` 中间件的替代方案，用于动态情况。
 * 支持 HTTP 缓存等。
 *
 *     app.get('/user/:uid/photos/:file', function(req, res){
 *       var uid = req.params.uid
 *         , file = req.params.file;
 *
 *       req.user.mayViewFilesFrom(uid, function(yes){
 *         if (yes) {
 *           res.sendFile('/uploads/' + uid + '/' + file);
 *         } else {
 *           res.send(403, 'Sorry! you cant see that.');
 *         }
 *       });
 *     });
 *
 * @public
 */
/**
 * 传输给定的 `path` 文件。
 * @param {*} path
 * @param {*} options
 * @param {*} callback
 */
res.sendFile = function sendFile(path, options, callback) {
  /**
   * 设置 done
   */
  var done = callback;
  /**
   * 设置 req
   */
  var req = this.req;
  /**
   * 设置 res
   */
  var res = this;
  /**
   * 设置 next
   */
  var next = req.next;
  /**
   * 设置 opts
   */
  var opts = options || {};

  if (!path) {
    throw new TypeError('path argument is required to res.sendFile');
  }

  if (typeof path !== 'string') {
    throw new TypeError('path must be a string to res.sendFile')
  }

  // support function as second arg
  if (typeof options === 'function') {
    done = options;
    opts = {};
  }

  if (!opts.root && !isAbsolute(path)) {
    throw new TypeError('path must be absolute or specify root to res.sendFile');
  }

  // create file stream
  var pathname = encodeURI(path);
  var file = send(req, pathname, opts);

  // transfer
  sendfile(res, file, opts, function (err) {
    if (done) return done(err);
    if (err && err.code === 'EISDIR') return next();

    // next() all but write errors
    if (err && err.code !== 'ECONNABORTED' && err.syscall !== 'write') {
      next(err);
    }
  });
};

/**
 * 传输给定的 `path` 文件。
 * Transfer the file at the given `path`.
 *
 * Automatically sets the _Content-Type_ response header field.
 * The callback `callback(err)` is invoked when the transfer is complete
 * or when an error occurs. Be sure to check `res.headersSent`
 * if you wish to attempt responding, as the header and some data
 * may have already been transferred.
 *
 * Options:
 *
 *   - `maxAge`   defaulting to 0 (can be string converted by `ms`)
 *   - `root`     root directory for relative filenames
 *   - `headers`  object of headers to serve with file
 *   - `dotfiles` serve dotfiles, defaulting to false; can be `"allow"` to send them
 *
 * Other options are passed along to `send`.
 *
 * Examples:
 *
 *  The following example illustrates how `res.sendfile()` may
 *  be used as an alternative for the `static()` middleware for
 *  dynamic situations. The code backing `res.sendfile()` is actually
 *  the same code, so HTTP cache support etc is identical.
 *
 *     app.get('/user/:uid/photos/:file', function(req, res){
 *       var uid = req.params.uid
 *         , file = req.params.file;
 *
 *       req.user.mayViewFilesFrom(uid, function(yes){
 *         if (yes) {
 *           res.sendfile('/uploads/' + uid + '/' + file);
 *         } else {
 *           res.send(403, 'Sorry! you cant see that.');
 *         }
 *       });
 *     });
 *
 * @public
 */

res.sendfile = function (path, options, callback) {
  /**
   * 设置 done
   */
  var done = callback;
  /**
   * 设置 req
   */
  var req = this.req;
  /**
   * 设置 res
   */
  var res = this;
  /**
   * 设置 next
   */
  var next = req.next;
  /**
   * 设置 opts
   */
  var opts = options || {};

  // support function as second arg
  if (typeof options === 'function') {
    done = options;
    opts = {};
  }

  // create file stream
  var file = send(req, path, opts);

  // transfer
  /**
   * 传输文件
   *
   */
  sendfile(res, file, opts, function (err) {
    if (done) return done(err);
    if (err && err.code === 'EISDIR') return next();

    // next() all but write errors
    if (err && err.code !== 'ECONNABORTED' && err.syscall !== 'write') {
      next(err);
    }
  });
};

res.sendfile = deprecate.function(res.sendfile,
  'res.sendfile: Use res.sendFile instead');

/**
 * Transfer the file at the given `path` as an attachment.
 *
 * Optionally providing an alternate attachment `filename`,
 * and optional callback `callback(err)`. The callback is invoked
 * when the data transfer is complete, or when an error has
 * occurred. Be sure to check `res.headersSent` if you plan to respond.
 *
 * Optionally providing an `options` object to use with `res.sendFile()`.
 * This function will set the `Content-Disposition` header, overriding
 * any `Content-Disposition` header passed as header options in order
 * to set the attachment and filename.
 *
 * This method uses `res.sendFile()`.
 *
 * @public
 */
/**
 * 下载给定的path文件
 * @param {*} path
 * @param {*} filename
 * @param {*} options
 * @param {*} callback
 * @returns
 */
res.download = function download (path, filename, options, callback) {
  /**
   * 设置 done
   */
  var done = callback;
  /**
   * 设置 name
   */
  var name = filename;
  /**
   * 设置 opts
   */
  var opts = options || null

  // support function as second or third arg
  if (typeof filename === 'function') {
    done = filename;
    name = null;
    opts = null
  } else if (typeof options === 'function') {
    done = options
    opts = null
  }

  // support optional filename, where options may be in it's place
  if (typeof filename === 'object' &&
    (typeof options === 'function' || options === undefined)) {
    name = null
    opts = filename
  }

  // set Content-Disposition when file is sent
  var headers = {
    'Content-Disposition': contentDisposition(name || path)
  };

  // merge user-provided headers
  if (opts && opts.headers) {
    var keys = Object.keys(opts.headers)
    /**
     * 遍历 keys
     */
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i]
      if (key.toLowerCase() !== 'content-disposition') {
        headers[key] = opts.headers[key]
      }
    }
  }

  // merge user-provided options
  opts = Object.create(opts)
  opts.headers = headers

  // Resolve the full path for sendFile
  var fullPath = !opts.root
    ? resolve(path)
    : path

  // send file
  return this.sendFile(fullPath, opts, done)
};

/**
 * Set _Content-Type_ response header with `type` through `mime.lookup()`
 * when it does not contain "/", or set the Content-Type to `type` otherwise.
 *
 * Examples:
 *
 *     res.type('.html');
 *     res.type('html');
 *     res.type('json');
 *     res.type('application/json');
 *     res.type('png');
 *
 * @param {String} type
 * @return {ServerResponse} for chaining
 * @public
 */
/**
 * 设置 _Content-Type_ 响应头字段
 * @param {*} type
 * @returns
 */
res.contentType =
res.type = function contentType(type) {
  var ct = type.indexOf('/') === -1
    ? mime.lookup(type)
    : type;

  return this.set('Content-Type', ct);
};

/**
 * Respond to the Acceptable formats using an `obj`
 * of mime-type callbacks.
 *
 * This method uses `req.accepted`, an array of
 * acceptable types ordered by their quality values.
 * When "Accept" is not present the _first_ callback
 * is invoked, otherwise the first match is used. When
 * no match is performed the server responds with
 * 406 "Not Acceptable".
 *
 * Content-Type is set for you, however if you choose
 * you may alter this within the callback using `res.type()`
 * or `res.set('Content-Type', ...)`.
 *
 *    res.format({
 *      'text/plain': function(){
 *        res.send('hey');
 *      },
 *
 *      'text/html': function(){
 *        res.send('<p>hey</p>');
 *      },
 *
 *      'application/json': function () {
 *        res.send({ message: 'hey' });
 *      }
 *    });
 *
 * In addition to canonicalized MIME types you may
 * also use extnames mapped to these types:
 *
 *    res.format({
 *      text: function(){
 *        res.send('hey');
 *      },
 *
 *      html: function(){
 *        res.send('<p>hey</p>');
 *      },
 *
 *      json: function(){
 *        res.send({ message: 'hey' });
 *      }
 *    });
 *
 * By default Express passes an `Error`
 * with a `.status` of 406 to `next(err)`
 * if a match is not made. If you provide
 * a `.default` callback it will be invoked
 * instead.
 *
 * @param {Object} obj
 * @return {ServerResponse} for chaining
 * @public
 */
/**
 * 响应格式
 * @param {*} obj
 * @returns
 */
res.format = function(obj){
  /**
   * 设置 req
   */
  var req = this.req;
  /**
   * 设置 next
   */
  var next = req.next;
  /**
   * 设置 keys
   */
  var keys = Object.keys(obj)
    .filter(function (v) { return v !== 'default' })
  /**
   * 设置 key
   */
  var key = keys.length > 0
    ? req.accepts(keys)
    : false;
  /**
   * 设置 vary
   */
  this.vary("Accept");
  /**
   * 如果 key 存在
   */
  if (key) {
    this.set('Content-Type', normalizeType(key).value);
    obj[key](req, this, next);
  } else if (obj.default) {
    obj.default(req, this, next)
  } else {
    next(createError(406, {
      types: normalizeTypes(keys).map(function (o) { return o.value })
    }))
  }

  return this;
};

/**
 * 设置 _Content-Disposition_ 头字段为 _attachment_ 并带有可选的 `filename`。
 *
 * @param {String} filename
 * @return {ServerResponse}
 * @public
 */

res.attachment = function attachment(filename) {
  if (filename) {
    this.type(extname(filename));
  }

  this.set('Content-Disposition', contentDisposition(filename));

  return this;
};

/**
 * Append additional header `field` with value `val`.
 *
 * Example:
 *
 *    res.append('Link', ['<http://localhost/>', '<http://localhost:3000/>']);
 *    res.append('Set-Cookie', 'foo=bar; Path=/; HttpOnly');
 *    res.append('Warning', '199 Miscellaneous warning');
 *
 * @param {String} field
 * @param {String|Array} val
 * @return {ServerResponse} for chaining
 * @public
 */
/**
 * 追加额外的头字段
 * @param {*} field
 * @param {*} val
 * @returns
 */
res.append = function append(field, val) {
  var prev = this.get(field);
  var value = val;
  /**
   * 如果 prev 存在
   */
  if (prev) {
    /**
     * 连接新的和 prev 的值
     */
    value = Array.isArray(prev) ? prev.concat(val)
      : Array.isArray(val) ? [prev].concat(val)
        : [prev, val]
  }

  return this.set(field, value);
};

/**
 * 设置头字段 `field` 为 `val`，或传递一个头字段对象。
 *
 * Examples:
 *
 *    res.set('Foo', ['bar', 'baz']);
 *    res.set('Accept', 'application/json');
 *    res.set({ Accept: 'text/plain', 'X-API-Key': 'tobi' });
 *
 * Aliased as `res.header()`.
 *
 * @param {String|Object} field
 * @param {String|Array} val
 * @return {ServerResponse} for chaining
 * @public
 */
/**
 * 设置头字段
 * @param {*} field
 * @param {*} val
 * @returns
 */
res.set =
res.header = function header(field, val) {
  /**
   * 如果参数长度为 2
   */
  if (arguments.length === 2) {
    var value = Array.isArray(val)
      ? val.map(String)
      : String(val);
    /**
     * 如果字段为 content-type
     */
    if (field.toLowerCase() === 'content-type') {
      if (Array.isArray(value)) {
        throw new TypeError('Content-Type cannot be set to an Array');
      }
      if (!charsetRegExp.test(value)) {
        var charset = mime.charsets.lookup(value.split(';')[0]);
        if (charset) value += '; charset=' + charset.toLowerCase();
      }
    }

    this.setHeader(field, value);
  } else {
    for (var key in field) {
      this.set(key, field[key]);
    }
  }
  return this;
};

/**
 * Get value for header `field`.
 *
 * @param {String} field
 * @return {String}
 * @public
 */
/**
 * 获取头字段值
 * @param {*} field
 * @returns
 */
res.get = function(field){
  return this.getHeader(field);
};

/**
 * Clear cookie `name`.
 *
 * @param {String} name
 * @param {Object} [options]
 * @return {ServerResponse} for chaining
 * @public
 */
/**
 * 清除 cookie
 * @param {*} name
 * @param {*} options
 * @returns
 */
res.clearCookie = function clearCookie(name, options) {
  if (options) {
    if (options.maxAge) {
      deprecate('res.clearCookie: Passing "options.maxAge" is deprecated. In v5.0.0 of Express, this option will be ignored, as res.clearCookie will automatically set cookies to expire immediately. Please update your code to omit this option.');
    }
    if (options.expires) {
      deprecate('res.clearCookie: Passing "options.expires" is deprecated. In v5.0.0 of Express, this option will be ignored, as res.clearCookie will automatically set cookies to expire immediately. Please update your code to omit this option.');
    }
  }
  var opts = merge({ expires: new Date(1), path: '/' }, options);

  return this.cookie(name, '', opts);
};

/**
 * 设置 cookie `name` 为 `value`，并带有给定的 `options`。
 *
 * Options:
 *
 *    - `maxAge`   max-age in milliseconds, converted to `expires`
 *    - `signed`   sign the cookie
 *    - `path`     defaults to "/"
 *
 * Examples:
 *
 *    // "Remember Me" for 15 minutes
 *    res.cookie('rememberme', '1', { expires: new Date(Date.now() + 900000), httpOnly: true });
 *
 *    // same as above
 *    res.cookie('rememberme', '1', { maxAge: 900000, httpOnly: true })
 *
 * @param {String} name
 * @param {String|Object} value
 * @param {Object} [options]
 * @return {ServerResponse} for chaining
 * @public
 */
/**
 * 设置 cookie
 * @param {*} name
 * @param {*} value
 * @param {*} options
 * @returns
 */
res.cookie = function (name, value, options) {
  var opts = merge({}, options);
  var secret = this.req.secret;
  var signed = opts.signed;

  if (signed && !secret) {
    throw new Error('cookieParser("secret") required for signed cookies');
  }
  /**
   * 设置 val
   */
  var val = typeof value === 'object'
    ? 'j:' + JSON.stringify(value)
    : String(value);
  /**
   * 如果 signed 存在
   */
  if (signed) {
    val = 's:' + sign(val, secret);
  }
  /**
   * 如果 opts.maxAge 存在
   */
  if (opts.maxAge != null) {
    var maxAge = opts.maxAge - 0
    /**
     * 如果 maxAge 不是 NaN
     */
    if (!isNaN(maxAge)) {
      /**
       * 设置 expires
       */
      opts.expires = new Date(Date.now() + maxAge)
      /**
       * 设置 maxAge
       */
      opts.maxAge = Math.floor(maxAge / 1000)
    }
  }
  /**
   * 如果 opts.path 不存在
   */
  if (opts.path == null) {
    opts.path = '/';
  }
  /**
   * 追加 Set-Cookie 头字段
   */
  this.append('Set-Cookie', cookie.serialize(name, String(val), opts));
  /**
   * 返回 this
   */
  return this;
};

/**
 * 设置 location 头字段为 `url`。
 *
 * 给定的 `url` 也可以是 "back"，它将重定向到 _Referrer_ 或 _Referer_ 头字段或 "/"。
 *
 * 例子：
 *
 *    res.location('/foo/bar').;
 *    res.location('http://example.com');
 *    res.location('../login');
 *
 * @param {String} url
 * @return {ServerResponse} for chaining
 * @public
 */

res.location = function location(url) {
  var loc;

  // "back" is an alias for the referrer
  if (url === 'back') {
    loc = this.req.get('Referrer') || '/';
  } else {
    loc = String(url);
  }

  return this.set('Location', encodeUrl(loc));
};

/**
 * Redirect to the given `url` with optional response `status`
 * defaulting to 302.
 *
 * The resulting `url` is determined by `res.location()`, so
 * it will play nicely with mounted apps, relative paths,
 * `"back"` etc.
 *
 * Examples:
 *
 *    res.redirect('/foo/bar');
 *    res.redirect('http://example.com');
 *    res.redirect(301, 'http://example.com');
 *    res.redirect('../login'); // /blog/post/1 -> /blog/login
 *
 * @public
 */
/**
 * 重定向
 * @param {*} url
 * @returns
 */
res.redirect = function redirect(url) {
  var address = url;
  var body;
  var status = 302;

  // allow status / url
  if (arguments.length === 2) {
    if (typeof arguments[0] === 'number') {
      status = arguments[0];
      address = arguments[1];
    } else {
      deprecate('res.redirect(url, status): Use res.redirect(status, url) instead');
      status = arguments[1];
    }
  }
  /**
   * 设置 location 头字段
   */
  address = this.location(address).get('Location');
  /**
   * 支持 text/{plain,html} 默认
   */
  this.format({
    text: function(){
      body = statuses.message[status] + '. Redirecting to ' + address
    },

    html: function(){
      var u = escapeHtml(address);
      body = '<p>' + statuses.message[status] + '. Redirecting to <a href="' + u + '">' + u + '</a></p>'
    },

    default: function(){
      body = '';
    }
  });
  /**
   * 设置 statusCode
   */
  this.statusCode = status;
  /**
   * 设置 Content-Length 头字段
   */
  this.set('Content-Length', Buffer.byteLength(body));

  if (this.req.method === 'HEAD') {
    this.end();
  } else {
    this.end(body);
  }
};

/**
 * 将 `field` 添加到 Vary。如果已经在 Vary 集中，则此调用将被忽略。
 *
 * @param {Array|String} field
 * @return {ServerResponse} for chaining
 * @public
 */

res.vary = function(field){
  // checks for back-compat
  if (!field || (Array.isArray(field) && !field.length)) {
    deprecate('res.vary(): Provide a field name');
    return this;
  }

  vary(this, field);

  return this;
};

/**
 * Render `view` with the given `options` and optional callback `fn`.
 * When a callback function is given a response will _not_ be made
 * automatically, otherwise a response of _200_ and _text/html_ is given.
 *
 * Options:
 *
 *  - `cache`     boolean hinting to the engine it should cache
 *  - `filename`  filename of the view being rendered
 *
 * @public
 */
/**
 * 渲染视图
 * @param {*} view
 * @param {*} options
 * @param {*} callback
 * @returns
 */
res.render = function render(view, options, callback) {
  var app = this.req.app;
  var done = callback;
  var opts = options || {};
  var req = this.req;
  var self = this;

  // support callback function as second arg
  if (typeof options === 'function') {
    done = options;
    opts = {};
  }

  // merge res.locals
  opts._locals = self.locals;

  // default callback to respond
  done = done || function (err, str) {
    if (err) return req.next(err);
    self.send(str);
  };

  // render
  app.render(view, opts, done);
};

/**
 * 管道发送文件流
 * @param {*} res
 * @param {*} file
 * @param {*} options
 * @param {*} callback
 * @returns
 */
function sendfile(res, file, options, callback) {
  var done = false;
  var streaming;
  /**
   * 如果请求被中止
   */
  function onaborted() {
    if (done) return;
    done = true;
    /**
     * 设置 err
     */
    var err = new Error('Request aborted');
    err.code = 'ECONNABORTED';
    callback(err);
  }
  /**
   * 如果目录
   */
  function ondirectory() {
    if (done) return;
    done = true;
    /**
     * 设置 err
     */
    var err = new Error('EISDIR, read');
    err.code = 'EISDIR';
    callback(err);
  }
  /**
   * 如果错误
   */
  function onerror(err) {
    if (done) return;
    done = true;
    callback(err);
  }

  /**
   * 如果结束
   */
  function onend() {
    if (done) return;
    done = true;
    callback();
  }

  /**
   * 如果文件
   */
  function onfile() {
    streaming = false;
  }

  /**
   * 如果完成
   */
  function onfinish(err) {
    if (err && err.code === 'ECONNRESET') return onaborted();
    if (err) return onerror(err);
    if (done) return;

    setImmediate(function () {
      if (streaming !== false && !done) {
        onaborted();
        return;
      }

      if (done) return;
      done = true;
      callback();
    });
  }

  /**
   * 如果流
   */
  function onstream() {
    streaming = true;
  }
  /**
   * 如果目录
   */
  file.on('directory', ondirectory);
  /**
   * 如果结束
   */
  file.on('end', onend);
  /**
   * 如果错误
   */
  file.on('error', onerror);
  file.on('file', onfile);
  file.on('stream', onstream);
  onFinished(res, onfinish);
  /**
   * 如果 headers
   */
  if (options.headers) {
    /**
     * 如果 headers
     */
    file.on('headers', function headers(res) {
      /**
       * 设置 headers
       */
      var obj = options.headers;
      var keys = Object.keys(obj);
      /**
       * 遍历 keys
       */
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        res.setHeader(k, obj[k]);
      }
    });
  }

  /**
   * 管道
   */
  file.pipe(res);
}

/**
 * 字符串化 JSON，像 JSON.stringify，但 v8 优化，具有转义可以触发 HTML 嗅探的字符的能力。
 *
 * @param {*} value
 * @param {function} replacer
 * @param {number} spaces
 * @param {boolean} escape
 * @returns {string}
 * @private
 */

function stringify(value, replacer, spaces, escape) {
  /**
   * v8 检查 arguments.length 以优化简单调用
   * https://bugs.chromium.org/p/v8/issues/detail?id=4730
   */
  var json = replacer || spaces
    ? JSON.stringify(value, replacer, spaces)
    : JSON.stringify(value);
  /**
   * 如果 escape 且 json 是字符串
   */
  if (escape && typeof json === 'string') {
    json = json.replace(/[<>&]/g, function (c) {
      switch (c.charCodeAt(0)) {
        case 0x3c:
          return '\\u003c'
        case 0x3e:
          return '\\u003e'
        case 0x26:
          return '\\u0026'
        /* istanbul ignore next: unreachable default */
        default:
          return c
      }
    })
  }

  return json
}
