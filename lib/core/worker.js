var Promise     = require('bluebird')
  , _           = require('lodash')
  , request     = require('request')
  , spy         = require('through2-spy')
  , dev_null    = require('dev-null')
  , url         = require('url')
  , io          = require('socket.io-client')
  ;

request.defaults({
  pool : { maxSockets: Infinity }
});

// todo [akamel] should not add spy in first place
// function log_spy() {
//   return spy(function(chunk, enc){
//     if (can_log_spy) {
//       console.log('spy: ', (new Buffer(chunk, enc)).toString());
//     }
//   });
// }

function Worker(options) {
  this.options = options;

  this.id         = this.options.id;
  this.port       = this.options.port;
  this.dir        = this.options.dir;

  this.url = url.format({
      protocol  : this.options.protocol || 'http'
    , hostname  : this.options.host     || 'localhost'
    , port      : this.port
  });
}

Worker.prototype.connect = function(cb){
  var cb = _.once(cb)
    ;

  this.socket = io(this.url);

  this.socket.once('connect', cb);

  this.socket.on('connect', this.on_connect.bind(this));

  this.socket.on('disconnect', this.on_disconnect.bind(this));

  this.socket.on('stdout', this.on_stdout.bind(this));

  this.socket.on('stderr', this.on_stderr.bind(this));
};

Worker.prototype.on_connect = function(){
  console.log('worker connected at', this.url);
};

Worker.prototype.on_disconnect = function(){
  console.log('worker disconnected', this.id);
  // todo [akamel] should we delete all?
};

Worker.prototype.reqs = {};

Worker.prototype.on_stdout = function(id, arg){
  var i = this.reqs[id];

  if (i && !_.isUndefined(arg)) {
    i.res.stdout.write(arg);
  }
};

Worker.prototype.on_stderr = function(){
  var i = this.reqs[id];

  if (i && !_.isUndefined(arg)) {
    i.res.stderr.write(arg);
  }
};

// todo [akamel] could we pipe to wrong request stdout/err if error happens way after res is done?
Worker.prototype.handle = function(req, res, next) {
  var id = req.task.id;

  this.socket.emit('execution', req.task);
  this.reqs[id] = { req : req, res : res, next : next };

  req.headers = req.headers || {};

  req.headers['$originalurl'] = req.url;
  req.headers['$execution-id'] = req.task.metadata.execution.id;
  // req.headers['$req-hostname'] = req.hostname;
  // req.headers['$req-port'] = req.hostname;

  res.on('end', function(){
    delete this.reqs[id];
  }.bind(this));

  req
    // .pipe(log_spy())
    .pipe(request({ url : this.url + '/execute', q: req.query, method: req.method, headers: req.headers }))
    .on('response', function(response) {
      res.writeHead(response.statusCode, response.headers);
    })
    .on('error', function(err){
      var body = {
          '#system' : {
              type    : 'exception'
            , error   : 'response pipe error'
            , details : err
          }
        };

      // res.stderr.write(new Buffer());
      next(body);
    })
    // .pipe(log_spy())
    .pipe(res)
    ;
};

module.exports = Worker;