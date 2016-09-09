"use strict";

var _             = require('lodash')
  , Promise       = require('bluebird')
  , urljoin       = require('url-join')
  , io            = require('socket.io-client')
  , config        = require('config-url')
  , man           = require('taskmill-core-man')
  , Repository    = require('./Repository')
  ;

class Request {
  constructor(req, res) {
    // todo [akamel] we only parse this to get the request id out... seems we should be able to bypass it
    let doc = JSON.parse(req.headers['__metadata']);
    
    this.doc    = doc;
    this.id     = doc.id;
    // todo [akamel] don't do this on each call; this is wasteful
    this.socket = _.has(this.doc, 'tty.ws')? io(urljoin(this.doc.tty.ws, 'tty')) : undefined;

    // todo [akamel] this is silly
    this._has_blob_header = !!doc.blob;

    this.remote = doc.remote;

    // todo [akamel] do we really need this?
    res.on('finish', () => {
      this.stdout(null);
    })
  }

  stdout(chunk) {
    this.tty(chunk, 'stdout');
  }

  stderr(chunk) {
    this.tty(chunk, 'stderr');
  }

  // todo [akamel] decode chunk to utf-8?
  tty(chunk, type) {
    if (this.socket) {
      this.socket.emit('/stream', {
          id        : this.id
        , tty_id    : this.doc.tty.id 
        , text      : chunk? chunk.toString('utf8') : chunk 
        , type      : type
      });
    }
  }

  canCoHost() {
    return !this._has_blob_header && !this.socket;
  }

  // can this request run
  acl(options) {
    return Promise
            .try(() => {
              if (!this.doc.remote) {
                throw new Error('unknown remote repository');
              }

              if (this.doc.blob) {
                if (!config.get('agent.allow-foreign-code')) {
                  throw new Error('running foreign code is not allowed');
                }
              }
            });
  }


  initialize() {
    return Promise
            .try(() => {
              if (this.doc.blob) {
                return { content : this.doc.blob };
              }

              // todo [akamel] get oauth token, run private code
              return Repository
                      .get(this.remote)
                      .then((repository) => {
                        let opt =  { 
                            branch : this.doc.branch
                          , token : undefined /*token*/
                        };

                        return repository.blob(this.doc.filename, opt);
                      });
            })
            .then((result) => {
              // todo [akamel] maybe we should rename to content? arg.....
              // todo [akamel] we are recalculating the manual even if it was already sent in...
              this.doc.blob = result.content;
              this.doc.manual = man.get(result.content);
            });
  }
}

module.exports = Request;