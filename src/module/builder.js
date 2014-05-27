'use strict';

RMModule.factory('RMBuilder', ['$injector', '$parse', '$filter', '$inflector', 'RMUtils', function($injector, $parse, $filter, $inflector, Utils) {

  // TODO: add urlPrefix option

  /**
   * @class BuilderApi
   *
   * @description
   *
   * Provides the DSL for model generation.
   *
   * ### About model descriptions
   *
   * This class is also responsible for parsing **model description objects** passed to
   * the mixin chain.
   *
   * Example of description:
   *
   * ```javascript
   * $restmod.model('', {
   *   propWithDefault: { init: 20 },
   *   propWithDecoder: { decode: 'date', chain: true },
   *   relation: { hasMany: 'Other' },
   * });
   * ```
   *
   * The descriptions are processed by the `describe` method and mapped to builder attribute methods.
   *
   * The following built in property modifiers are provided (see each method docs for usage information):
   *
   * * `init` maps to {@link BuilderApi#attrDefault}
   * * `mask` and `ignore` maps to {@link BuilderApi#attrMask}
   * * `decode` maps to {@link BuilderApi#attrDecoder}
   * * `encode` maps to {@link BuilderApi#attrEncoder}
   * * `serialize` maps to {@link BuilderApi#attrSerializer}
   * * `hasMany` maps to {@link BuilderApi#hasMany}
   * * `hasOne` maps to {@link BuilderApi#hasOne}
   *
   * Mapping a *primitive* to a property is the same as using the `init` modifier.
   * Mapping a *function* to a property calls {@link BuilderApi#define} on the function.
   *
   */
  function BuilderDSL(_targetModel) {
    this.$$m = _targetModel;
    this.$$mappings = {
      init: ['attrDefault'],
      mask: ['attrMask'],
      ignore: ['attrMask'],
      decode: ['attrDecoder', 'param', 'chain'],
      encode: ['attrEncoder', 'param', 'chain'],
      serialize: ['attrSerializer'],
      // relations
      hasMany: ['attrAsCollection', 'path', 'source', 'inverseOf'],
      hasOne: ['attrAsResource', 'path', 'source', 'inverseOf'],
      belongsTo: ['attrAsReference', 'inline', 'key', 'source', 'prefetch']
    };
  }

  BuilderDSL.prototype = {

    setHttpOptions: function(_options) {
      // TODO.
    },

    /**
     * @memberof BuilderApi#
     *
     * @description Sets an url prefix to be added to every url generated by the model.
     *
     * This applies even to objects generated by the `$single` method.
     *
     * This method is intended to be used in a base model mixin so everymodel that extends from it
     * gets the same url prefix.
     *
     * Usage:
     *
     * ```javascript
     * var BaseModel = $restmod.mixin(function() {
     *   this.setUrlPrefix('/api');
     * })
     *
     * var bike = $restmod.model('/bikes', BaseModel).$build({ id: 1 });
     * console.log(bike.$url()) // outputs '/api/bikes/1'
     * ```
     *
     * @param {string} _prefix url portion
     * @return {BuilderApi} self
     */
    setUrlPrefix: function(_prefix) {
      this.$$m.$$urlPrefix = _prefix;
      return this;
    },

    /**
     * @memberof BuilderApi#
     *
     * @description Changes the model's primary key.
     *
     * Primary keys are passed to scope's url methods to generate urls. The default primary key is 'id'.
     *
     * **ATTENTION** Primary keys are extracted from raw data, so _key must use raw api naming.
     *
     * @param {string|function} _key New primary key.
     * @return {BuilderApi} self
     */
    setPrimaryKey: function(_key) {
      this.$$m.$$primaryKey = _key;
      return this;
    },

    /**
     * @memberof BuilderApi#
     *
     * @description Changes the way restmod renames attributes every time a server resource is decoded.
     *
     * This is intended to be used as a way of keeping property naming style consistent accross
     * languajes. By default, property naming in js should use camelcase and property naming
     * in JSON api should use snake case with underscores.
     *
     * If `false` is given, then renaming is disabled
     *
     * @param {function|false} _value decoding function
     * @return {BuilderApi} self
     */
    setNameDecoder: function(_decoder) {
      this.$$m.$$nameDecoder = _decoder;
      return this;
    },

    /**
     * @memberof BuilderApi#
     *
     * @description Changes the way restmod renames attributes every time a local resource is encoded to be sent.
     *
     * This is intended to be used as a way of keeping property naming style consistent accross
     * languajes. By default, property naming in js should use camelcase and property naming
     * in JSON api should use snake case with underscores.
     *
     * If `false` is given, then renaming is disabled
     *
     * @param {function|false} _value encoding function
     * @return {BuilderApi} self
     */
    setNameEncoder: function(_encoder) {
      this.$$m.$$nameEncoder = _encoder;
      return this;
    },

    /**
     * @memberof BuilderApi#
     *
     * @description Disables renaming alltogether
     *
     * @return {BuilderApi} self
     */
    disableRenaming: function() {
      return this
        .setNameDecoder(false)
        .setNameEncoder(false);
    },

    /**
     * @memberof BuilderApi#
     *
     * @description Extends the builder DSL
     *
     * Adds a function to de builder and alternatively maps the function to an
     * attribute definition keyword that can be later used when calling
     * `define` or `attribute`.
     *
     * Mapping works as following:
     *
     *    // Given the following call
     *    builder.extend('testAttr', function(_attr, _test, _param1, param2) {
     *      // wharever..
     *    }, ['test', 'testP1', 'testP2']);
     *
     *    // A call to
     *    builder.attribute('chapter', { test: 'hello', testP1: 'world' });
     *
     *    // Its equivalent to
     *    builder.testAttr('chapter', 'hello', 'world');
     *
     * The method can also be passed an object with various methods to be added.
     *
     * @param {string|object} _name function name or object to merge
     * @param {function} _fun function
     * @param {array} _mapping function mapping definition
     * @return {BuilderApi} self
     */
    extend: function(_name, _fun, _mapping) {
      if(typeof _name === 'string') {
        this[_name] = Utils.override(this[name], _fun);
        if(_mapping) {
          this.$$mappings[_mapping[0]] = _mapping;
          _mapping[0] = _name;
        }
      } else Utils.extendOverriden(this, _name);
      return this;
    },

    /**
     * @memberof BuilderApi#
     *
     * @description Parses a description object, calls the proper builder method depending
     * on each property description type.
     *
     * @param {object} _description The description object
     * @return {BuilderApi} self
     */
    describe: function(_description) {
      forEach(_description, function(_desc, _attr) {
        switch(_attr.charAt(0)) {
        case '@':
          this.classDefine(_attr.substring(1), _desc);
          break;
        case '~':
          _attr = $inflector.parameterize(_attr.substring(1));
          this.on(_attr, _desc);
          break;
        default:
          if(isObject(_desc)) this.attribute(_attr, _desc);
          else if(isFunction(_desc)) this.define(_attr, _desc);
          else this.attrDefault(_attr, _desc);
        }
      }, this);
      return this;
    },

    /**
     * @memberof BuilderApi#
     *
     * @description Sets an attribute properties.
     *
     * This method uses the attribute modifiers mapping to call proper
     * modifiers on the argument.
     *
     * For example, using the following description on the createdAt attribute
     *
     *    { decode: 'date', param; 'YY-mm-dd' }
     *
     * Is the same as calling
     *
     *    builder.attrDecoder('createdAt', 'date', 'YY-mm-dd')
     *
     * @param {string} _name Attribute name
     * @param {object} _description Description object
     * @return {BuilderApi} self
     */
    attribute: function(_name, _description) {
      var key, map, args, i;
      for(key in _description) {
        if(_description.hasOwnProperty(key)) {
          map = this.$$mappings[key];
          if(map) {
            args = [_name, _description[key]];
            for(i = 1; i < map.length; i++) {
              args.push(_description[map[i]]);
            }
            args.push(_description);
            this[map[0]].apply(this, args);
          }
        }
      }
      return this;
    },

    /**
     * @memberof BuilderApi#
     *
     * @description Sets the default value for an attribute.
     *
     * Defaults values are set only on object construction phase.
     *
     * if `_init` is a function, then its evaluated every time the
     * default value is required.
     *
     * @param {string} _attr Attribute name
     * @param {mixed} _init Defaulf value / iniline function
     * @return {BuilderApi} self
     */
    attrDefault: function(_attr, _init) {
      // IDEA: maybe fixed defaults could be added to Model prototype...
      this.$$m.$$defaults.push([_attr, _init]);
      return this;
    },

    /**
     * @memberof BuilderApi#
     *
     * @description Sets an attribute mask.
     *
     * An attribute mask prevents the attribute to be loaded from or sent to the server on certain operations.
     *
     * The attribute mask is a string composed by:
     * * C: To prevent attribute from being sent on create
     * * R: To prevent attribute from being loaded from server
     * * U: To prevent attribute from being sent on update
     *
     * For example, the following will prevent an attribute to be send on create or update:
     *
     * ```javascript
     * builder.attrMask('readOnly', 'CU');
     * ```
     *
     * If a true boolean value is passed as mask, then 'CRU' will be used
     * If a false boolean valus is passed as mask, then mask will be removed
     *
     * @param {string} _attr Attribute name
     * @param {boolean|string} _mask Attribute mask
     * @return {BuilderApi} self
     */
    attrMask: function(_attr, _mask) {
      this.$$m.$$setMask(_attr, _mask);
      return this;
    },

    /**
     * @memberof BuilderApi#
     *
     * @description Assigns a serializer to a given attribute.
     *
     * A _serializer is:
     * * an object that defines both a `decode` and a `encode` method
     * * a function that when called returns an object that matches the above description.
     * * a string that represents an injectable that matches any of the above descriptions.
     *
     * @param {string} _name Attribute name
     * @param {string|object|function} _serializer The serializer
     * @return {BuilderApi} self
     */
    attrSerializer: function(_name, _serializer, _opt) {
      if(typeof _serializer === 'string') {
        _serializer = $injector.get($inflector.camelize(_serializer, true) + 'Serializer');
      }

      // TODO: if(!_serializer) throw $setupError
      if(isFunction(_serializer)) _serializer = _serializer(_opt);
      if(_serializer.decode) this.attrDecoder(_name, bind(_serializer, _serializer.decode));
      if(_serializer.encode) this.attrEncoder(_name, bind(_serializer, _serializer.encode));
      return this;
    },

    /**
     * @memberof BuilderApi#
     *
     * @description Assigns a decoding function/filter to a given attribute.
     *
     * @param {string} _name Attribute name
     * @param {string|function} _filter filter or function to register
     * @param {mixed} _filterParam Misc filter parameter
     * @param {boolean} _chain If true, filter is chained to the current attribute filter.
     * @return {BuilderApi} self
     */
    attrDecoder: function(_name, _filter, _filterParam, _chain) {
      if(typeof _filter === 'string') {
        var filter = $filter(_filter);
        // TODO: if(!_filter) throw $setupError
        _filter = function(_value) { return filter(_value, _filterParam); };
      }

      this.$$m.$$decoders[_name] = _chain ? Utils.chain(this.$$m.$$decoders[_name], _filter) : _filter;
      return this;
    },

    /**
     * @memberof BuilderApi#
     *
     * @description Assigns a encoding function/filter to a given attribute.
     *
     * @param {string} _name Attribute name
     * @param {string|function} _filter filter or function to register
     * @param {mixed} _filterParam Misc filter parameter
     * @param {boolean} _chain If true, filter is chained to the current attribute filter.
     * @return {BuilderApi} self
     */
    attrEncoder: function(_name, _filter, _filterParam, _chain) {
      if(typeof _filter === 'string') {
        var filter = $filter(_filter);
        // TODO: if(!_filter) throw $setupError
        _filter = function(_value) { return filter(_value, _filterParam); };
      }

      this.$$m.$$encoders[_name] = _chain ? Utils.chain(this.$$m.$$encoders[_name], _filter) : _filter;
      return this;
    },

    /**
     * @memberof BuilderApi#
     *
     * @description Registers a model **resources** relation
     *
     * @param {string}  _name Attribute name
     * @param {string|object} _model Other model, supports a model name or a direct reference.
     * @param {string} _url Partial url
     * @param {string} _source Inline resource alias (optional)
     * @param {string} _inverseOf Inverse property name (optional)
     * @return {BuilderApi} self
     */
    attrAsCollection: function(_attr, _model, _url, _source, _inverseOf) {
      return this.attrDefault(_attr, function() {

        if(typeof _model === 'string') {
          _model = $injector.get(_model);

          if(_inverseOf) {
            _model.$$setMask(_inverseOf, WRITE_MASK);
          }
        }

        var self = this,
            scope = this.$buildScope(_model, _url || $inflector.parameterize(_attr)),
            col = _model.$collection(null, scope);

        // TODO: there should be a way to modify scope behavior just for this relation,
        // since relation item scope IS the collection, then the collection should
        // be extended to provide a modified scope. For this an additional _extensions
        // parameters could be added to collection, then these 'extensions' are inherited
        // by child collections, the other alternative is to enable full property inheritance ...

        // set inverse property if required.
        if(_inverseOf) {
          col.$on('after-add', function(_obj) {
            _obj[_inverseOf] = self;
          });
        }

        return col;
      // simple support for inline data, TODO: maybe deprecate this.
      }).attrDecoder(_source || _url || _attr, function(_raw) {
        this[_attr].$reset().$feed(_raw);
      }).attrMask(_attr, WRITE_MASK);
    },

    /**
     * @memberof BuilderApi#
     *
     * @description Registers a model **resource** relation
     *
     * @param {string}  _name Attribute name
     * @param {string|object} _model Other model, supports a model name or a direct reference.
     * @param {string} _url Partial url (optional)
     * @param {string} _source Inline resource alias (optional)
     * @param {string} _inverseOf Inverse property name (optional)
     * @return {BuilderApi} self
     */
    attrAsResource: function(_attr, _model, _url, _source, _inverseOf) {

      return this
        .attrDefault(_attr, function() {

          if(typeof _model === 'string') {
            _model = $injector.get(_model);

            if(_inverseOf) {
              _model.$$setMask(_inverseOf, WRITE_MASK);
            }
          }

          var scope = this.$buildScope(_model, _url || $inflector.parameterize(_attr)),
              inst = new _model(scope);

          // TODO: provide a way to modify scope behavior just for this relation

          if(_inverseOf) {
            inst[_inverseOf] = this;
          }

          return inst;
        })
        // simple support for inline data, TODO: maybe deprecate this.
        .attrDecoder(_source || _url || _attr, function(_raw) {
          this[_attr].$decode(_raw);
        })
        .attrMask(_attr, WRITE_MASK);
    },

    /**
     * @memberof BuilderApi#
     *
     * @description Registers a model **reference** relation.
     *
     * A reference relation
     *
     * @param {string}  _name Attribute name
     * @param {string|object} _model Other model, supports a model name or a direct reference.
     * @param {bool} _inline If true, model data is expected to be inlined in parent response.
     * @param {string} _key reference id property name (optional, defaults to _attr + 'Id')
     * @param {bool} _prefetch if set to true, $fetch will be automatically called on relation object load.
     * @return {BuilderApi} self
     */
    attrAsReference: function(_attr, _model, _inline, _key, _source, _prefetch) {

      var watch = _inline ? (_source || _attr) : (_key || (_attr + 'Id'));
      this
        .attrDefault(_attr, null)
        .attrMask(_attr, WRITE_MASK)
        .attrDecoder(watch , function(_raw) {

          // load model
          if(typeof _model === 'string') {
            _model = $injector.get(_model);
          }

          // only reload object if id changes
          if(_inline)
          {
            if(!this[_attr] || this[_attr].$pk !== _model.$inferKey(_raw)) {
              this[_attr] = _model.$buildRaw(_raw);
            } else {
              this[_attr].$decode(_raw);
            }
          }
          else
          {
            if(!this[_attr] || this[_attr].$pk !== _raw) {
              this[_attr] = _model.$new(_raw); // use $new instead of $build
              if(_prefetch) {
                this[_attr].$fetch();
              }
            }
          }
        });
    },

    /**
     * @memberof BuilderApi#
     *
     * @description Registers an instance method
     *
     * Usage:
     *    builder.define(function(_super) {
     *      return $fetch()
     *    });
     *
     * It is posible to override an existing method using define,
     * if overriden, the old method can be called using `this.$super`
     * inside de new method.
     *
     * @param {string} _name Method name
     * @param {function} _fun Function to define
     * @return {BuilderApi} self
     */
    define: function(_name, _fun) {
      if(typeof _name === 'string') {
        this.$$m.prototype[_name] = Utils.override(this.$$m.prototype[_name], _fun);
      } else {
        Utils.extendOverriden(this.$$m.prototype, _name);
      }
      return this;
    },

    /**
     * @memberof BuilderApi#
     *
     * @description Registers a class method
     *
     * It is posible to override an existing method using define,
     * if overriden, the old method can be called using `this.$super`
     * inside de new method.
     *
     * @param {string} _name Method name
     * @param {function} _fun Function to define
     * @return {BuilderApi} self
     */
    classDefine: function(_name, _fun) {
      if(typeof _name === 'string') {
        this.$$m.Collection.prototype[_name] = Utils.override(this.$$m.Collection.prototype[_name], _fun);
        this.$$m[_name] = Utils.override(this.$$m[_name], _fun);
      } else {
        Utils.extendOverriden(this.$$m.Collection.prototype, _name);
        Utils.extendOverriden(this.$$m, _name);
      }
      return this;
    },

    /**
     * @memberof BuilderApi#
     *
     * @description Adds an event hook
     *
     * Hooks are used to extend or modify the model behavior, and are not
     * designed to be used as an event listening system.
     *
     * The given function is executed in the hook's context, different hooks
     * make different parameters available to callbacks.
     *
     * @param {string} _hook The hook name, refer to restmod docs for builtin hooks.
     * @param {function} _do function to be executed
     * @return {BuilderApi} self
     */
    on: function(_hook, _do) {
      this.$$m.$on(_hook, _do);
      return this;
    },

    /// Experimental modifiers

    /**
     * @memberof BuilderApi#
     *
     * @description Expression attributes are evaluated every time new data is fed to the model.
     *
     * @param {string}  _name Attribute name
     * @param {string} _expr Angular expression to evaluate
     * @return {BuilderApi} self
     */
    attrExpression: function(_name, _expr) {
      var filter = $parse(_expr);
      this.on('after-feed', function() {
        this[_name] = filter(this);
      });
    }
  };

  function Builder(_target) {
    this.dsl = new BuilderDSL(_target);
  }

  Builder.prototype = {
    // use the builder to process a mixin chain
    loadMixinChain: function(_chain) {
      for(var i = 0, l = _chain.length; i < l; i++) {
        this.loadMixin(_chain[i]);
      }
    },

    // use the builder to process a single mixin
    loadMixin: function(_mix) {
      if(_mix.$chain) {
        this.loadMixinChain(_mix.$chain);
      } else if(typeof _mix === 'string') {
        this.loadMixin($injector.get(_mix));
      } else if(isArray(_mix) || isFunction(_mix)) {
        // TODO: maybe invoke should only be called for BASE_CHAIN functions
        $injector.invoke(_mix, this.dsl, { $builder: this.dsl });
      } else this.dsl.describe(_mix);
    }
  };

  return Builder;

}]);