/*jshint strict:true node:true es5:true onevar:true laxcomma:true laxbreak:true*/
/*
 * SERVER
 */
(function () {
  "use strict";

  // TODO on create pass in database with get, set, query, etc
  var steve = require('./steve')
    , connect = require('connect')
    , crypto = require('crypto')
    , app = connect.createServer()
    , store = require('json-storage').create(require('dom-storage').create('users.db.json'))
    , db = {
          "coolaj86": {
              "passphrase": "secret"
            , "username": "coolaj86"
            , "email": "coolaj86@gmail.com"
            , "nickname": "AJ"
            //, "otp": "0123456789abcdef"
            , "salt": null
          }
        , "foo": {
              "passphrase": "secret"
            , "username": "foo"
            //, "otp": "0123456789abcdef"
            , "salt": null
          }
      }
    , otpDb = {}
    ;

  store.set('coolaj86', db.coolaj86);
  store.set('foo', db.foo);

  function randomString(len) {
    var i
      , chars = ""
      , str = ""
      , char
      , rnd
      ;

    // 32-126
    for (i = 32; i <= 126; i += 1) {
      chars += String.fromCharCode(i);
    } 

    if (isNaN(len)) {
      len = 8;
    }

    for (i = 0; i < len; i += 1) {
      rnd = Math.floor(Math.random() * chars.length);
      str += chars[rnd];
    }
    return str;
    //return "thesecret";
  }

  function hashSecret(secret, salt) {
    if (!secret || !salt) {
      throw new Error('Missing some secret salt!');
    }
    return crypto.createHash('sha1').update(salt + secret).digest('hex');
  }

  function restfullyAuthenticateUser(req) {
    var token
      , username
      , pass
      , account
      , basicAuthB64
      ;

    basicAuthB64 = (req.headers.authorization||"").replace(/\s*Basic\s+/i, '');
    token = (new Buffer(basicAuthB64, "base64"))
      .toString('utf8')
      .split(/:/) // not g
      ;

    username = token.shift(); // TODO disallow ':' in username
    pass = token.join(':'); // a password might have a ':'

    account = store.get(username);
    if (!account) {
      console.warn('No user', username);
      return;
    }

    // auto-update unsalted passwords
    if (!account.salt) {
      account.salt = randomString(255);
      account.passphrase = hashSecret(account.passphrase, account.salt);
    }

    console.log(pass.length, pass.substr(0, 3));
    console.log('client     :', pass);
    console.log('client+salt:', hashSecret(pass, account.salt));
    console.log('original   :', account.otp);
    console.log('original   :', account.passphrase);
    if ((258 === pass.length) && ('otp' === pass.substr(0, 3))) {
      console.log('looks like otp');
      if (pass.substr(3) === account.otp) {
        account.otp = randomString(255);
      } else {
        console.log('otp doesn\'t match');
        return;
      }
    } else if (hashSecret(pass, account.salt) !== account.passphrase) {
      console.log('login+pass doesn\'t match');
      return;
    }

    console.log('looks like success');
    account.otp = account.otp || randomString(255);
    store.set(username, account);
    return account;
  }

  function createUser(session, username, passphrase, extra) {
    var user = true
      , account
      , salt = randomString(255)
      ;

    if (username && store.get(username)) {
      username = undefined;
    }
    while (user) {
      username = username || ('guest' + Math.floor(Math.random() * 1000000000000));
      user = store.get(username);
    }

    account = {
        "passphrase": hashSecret(passphrase || randomString(255), salt)
      , "username": username
      , "salt": salt
      , "createdAt": Date.now()
      , "updatedAt": Date.now()
      , "authenticatedAt": Date.now()
      , "guest": true
    };

    if (extra) {
      Object.keys(account).forEach(function (key) {
        extra[key] = account[key];
      });
      account = extra;
    }

    account.otp = account.otp || randomString(255);

    store.set(account.username, account);
    return account;
  }

  function addAccountInfoToSession(session, account) {
    session.username = account.username;
    // The only valid use of secret as a property
    session.secret = 'otp' + account.otp;
    session.createdAt = account.createdAt;
    session.updatedAt = account.updatedAt;
    session.authenticatedAt = account.authenticatedAt;
  }

  // steve's cookieless-session does the magic
  // we just have to auth if credentials are given
  function restfullyAuthenticateSession(req, res, next) {
    var account
      ;

    if (req.headers.authorization) {
      account = restfullyAuthenticateUser(req);
      if (!account) {
        res.error('authentication did not complete (creating a guest)');
        // TODO url mangle as to fall through to a create user route?
        account = createUser(req.session);
      }
    } else {
      account = createUser(req.session);
    }

    addAccountInfoToSession(req.session, account);
    res.json(req.session);
  }

  function restfullyCreateUser(req, res, next) {
    var account = req.body
      , existingAccount
      ;

    if (!account) {
      res.error('no post body');
      res.json();
      return;
    }

    if (!account.username) {
      res.error('no username');
    } else if (store.get(account.username)) {
      // TODO add a code for easy 'iforgot' prompt
      // TODO the user gets the account, but it must be renamed
      // TODO if the password matches, respond as a a login attempt
      account.username = undefined;
      res.error('account exists');
    }

    if (/^guest/i.exec(account.username)) {
      res.error('a username may not begin with the word "guest"');
    }
    if (!account.passphrase) {
      res.error('no passphrase');
    } 

    account = createUser(req.session, account.username, account.passphrase, account);
    addAccountInfoToSession(req.session, account);

    res.json(req.session);
  }

  function checkOrGetUser(req, res, next) {
    // The user is NOT the authenticated user
    if (req.session.username !== req.params.id) {
      res.json(!!store.get(req.params.id));
      return;
    }

    // The user IS the authenticated user
    res.json(store.get(req.params.id));
  }

  function router(rest) {
    // This will create a guest user if no user is available
    rest.post('/session', restfullyAuthenticateSession);
    rest.post('/sessions', restfullyAuthenticateSession);

    // This will create a user (and merge the guest user) and authn the session;
    rest.post('/user', restfullyCreateUser);
    rest.post('/users', restfullyCreateUser);

    rest.get('/users/:id', checkOrGetUser);
  }

  app
    .use(steve)
    .use(connect.router(router))
    ;

  module.exports = app;
}());
