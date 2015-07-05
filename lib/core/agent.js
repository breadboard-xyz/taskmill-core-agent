var Promise         = require('bluebird')
  , _               = require('lodash')
  , os              = require('os')
  , upnode          = require('upnode')
  , uuid            = require('node-uuid')
  , config          = require('config')
  , dnode_stream    = require('dnode-http-stream')
  , dev_null        = require('dev-null')
  ;
function Agent(pool) {
  this.pool = pool;

  this.group = config.get('group.id');
  this.id = uuid.v4();

  if (!this.group) {
    throw new Error('group id is required for the agent to connect to the dispatcher. make sure that your group id is unique.');
  }
}

Agent.prototype.initialize = function(cb) {
  var time = process.hrtime();

  Promise
    .promisify(this.pool.kill_workers, this.pool)()
    .bind(this)
    .then(function(){
      var pool = this.pool
        , acts = []
        ;

      _.times(config.get('worker.count'), function(){
        acts.push(Promise.promisify(pool.create_worker, pool)());
      });

      return Promise
              .all(acts)
              .then(function(workers){
                return Promise.all(_.map(workers, function(worker){
                  return Promise
                          .promisify(pool.prepare, pool)(worker)
                          .then(function(){
                            return Promise.promisify(pool.start, pool)(worker);
                          })
                          .then(function(){
                            return Promise.promisify(worker.connect, worker)();
                          })
                          ;
                }));
              })
              ;
    })
    .then(function(){
      var diff = process.hrtime(time);

      console.log('all workers ready: ', diff[0] + diff[1] / 1e9);
    })
    .nodeify(cb)
    ;
};

Agent.prototype.handle = function(req, res, next) {
  var worker = this.pool.get_worker(req);

  if (worker) {
    this.up(function(remote){
      var dnode_req         = dnode_stream.readable(req.uuid)
        , dnode_res         = dnode_stream.writable(remote, res.uuid)
        ;

      if (res.stdout.uuid) {
        dnode_res.stdout  = dnode_stream.writable(remote, res.stdout.uuid);
      }

      if (res.stderr.uuid) {
        dnode_res.stderr  = dnode_stream.writable(remote, res.stderr.uuid);
      }

      _.extend(dnode_req, _.pick(req, 'query', 'method', 'headers', 'url', 'protocol'));

      dnode_req.task = req.task;

      dnode_res
        .on('end', function(){
          dnode_res.stdout.end();
          dnode_res.stderr.end();
        })
        // the on'end' handler needs to be before the pipe to dev_null
        .pipe(dev_null())
        ;

      worker.handle(dnode_req, dnode_res, next);
    });
  } else {
    next && next(new Error('no workers available'));
  }
};

Agent.prototype.listen = function() {
  var me = this;

  console.log('connecting to:', config.get('dispatcher.host'), config.get('dispatcher.port'));
  this.up = upnode(function(remote, conn){
              // this.heartbeat = me.heartbeat.bind(me);
              this.handle = me.handle.bind(me);
              this.write = dnode_stream.readable.write;

              conn.on('error', function(err){
                console.log('upnode err', err.stack);
              })
              .on('end', function(){
                console.log('upnode end', arguments);
              })
              .on('fail', function(){
                console.log('upnode fail', arguments);
              })
              .on('close', function(){
                console.log('upnode close', arguments);
              });
            })
            .connect({ host : config.get('dispatcher.host'), port : config.get('dispatcher.port') });

  this.ensure_heartbeat();
};

Agent.prototype.ensure_heartbeat = function() {
  var me = this;

  this.up(function(remote){
    if (this.heartbeat_timer_token) {
      clearInterval(me.heartbeat_timer_token);
    }

    me.heartbeat_timer_token = setInterval(function(){
      remote.heartbeat({
          name          : os.hostname()
        , id            : this.id
        , group         : me.group
        , worker_count  : me.pool.size()
        , uptime        : process.uptime()
      });
    }, 1000);
  });
};

module.exports = Agent;