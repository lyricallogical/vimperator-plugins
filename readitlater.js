/*
 * readitlater.js
 * read it later apiをたたく
 * API Reffernce : http://readitlaterlist.com/api/docs/
 * TODO:ADDにbufferからのリストを入れられるように
*/

let PLUGIN_INFO =
<VimperatorPlugin>
	<name>readitlater</name>
	<description lang="ja">Read it Later を快適に使うためのプラグインです</description>
	<version>0.2.1</version>
	<minVersion>3.0</minVersion>
	<maxVersion>3.2</maxVersion>
	<author mail="ninja.tottori@gmail.com" homepage="http://twitter.com/ninja_tottori">ninja.tottori</author>
	<updateURL>https://github.com/vimpr/vimperator-plugins/raw/master/readitlater.js</updateURL>
	<detail lang="ja"><![CDATA[

	Q.これは何？
	A.Read it Later を快適に使うためのプラグインです

	注意1.
		パスワードマネージャに依存してるので、ReadItLaterのID/PWをパスワードマネージャに登録しておく必要があります。

	注意2.
		API Key を使うので
		http://readitlaterlist.com/api/signup/
		から自分のAPI Keyを取得して
		rcファイルに let g:readitlater_api_key = "api key" と書いておいた方が良いと思います。
		デフォルトではあらかじめ私が取得したAPI Key使ってますが、一定時間内のリクエスト数などに制限があるみたいです。
		同じキーで1時間に10000回コールするとアレされるそうなので、チームotsuneの方達などは独自で取った方がいいかと思います。


		== Command ==
	:ril
	:ril add
		今見ているページのurlとtitleを登録します
		オプションとして url , title が選べるので適当に編集して登録もできます。

	:ril get
		登録されてるページの情報を取得してキャッシュしときます。
		デフォルトは50件ですが
		let g:readitlater_get_count = 100
		とかで取得件数を変更できます。
		add , open , read された後に問答無用で同期かけに行ってますので、件数をやたらに増やさない方がいいかもしれません。

	:ril open
		<Space>で補完にreaditlaterのリストが出てくるので、任意のURLを選択(<Space>)して実行すると新しいタブに開きます。
		:ril open! と!をつけると既読のみ補完に表示されます。

		また、開くと同時に既読フラグを立てに行く事ができます。
		let g:readitlater_open_as_read = 1
		としてもらえれば大丈夫です。
		※初回はキャッシュにデータが入っていないと思うので自分で:ril getしてやる必要があります。

	:ril read
		既読フラグを立てる為のサブコマンドです。
		openした時に既読にしたくないっていう人はこれを使って既読フラグを立てて下さい。

	:ril stats
		since, list, unread, read の情報がとれます


	]]></detail>
</VimperatorPlugin>;


(function(){

	commands.addUserCommand(["ril","readitlater"],	"Read It Late plugin",
		function(args){
			addItemByArgs(args);
		},
		{
		subCommands: [
			new Command(["add","a"], "Add a page to a user's list",
				function (args) {
					addItemByArgs(args);
				},{
				options : [
					[["url","u"],commands.OPTION_STRING,null,
							(function(){
							return [[ buffer.URL ,"target url"]]
						})
					],

					[["title","t"],commands.OPTION_STRING,null,
							(function(){
							return [[ buffer.title ,"title"]]
						})
					],
				],
				}
			),

			new Command(["get","g"], "Retrieve a user's reading list",
				function (args) {
          ListCache.update(true, function(data) echo(countObjectValues(data.list) + " found."));
				},{
				options : [
					//[["num"],commands.OPTION_INT],
					//[["read","-r"],commands.OPTION_NOARG],
					//[["tags","-t"],commands.OPTION_NOARG],
					//[["myAppOnly"],commands.OPTION_NOARG],
				],
				}
			),

			new Command(["open","o"], "Open url in new tab from RIL list.",
				function (args) {
					liberator.open(args, liberator.NEW_BACKGROUND_TAB);
					if(liberator.globalVariables.readitlater_open_as_read == 1) markAsRead(args);
				},{
					bang: true,
					completer : listCompleter,
				}
			),

			new Command(["read","r"], "Mark items as read.",
				function (args) {
					markAsRead(args);
				},{
					bang: true,
					completer : listCompleter,
				}
			),

			new Command(["stats","s"], "Retrieve information about a user's list",
				function (args) {
					ReadItLater.stats();
				},{}
			),

			/*
			new Command(["test"], "Return stats / current rate limit information about your API key",
				function () {
					ReadItLater.apiTest();
				},{}
			),
			*/
		],


		},
		true
	);

	const CacheStore = storage.newMap("readitlater",{store:true});

  // Cache {{{
	function Cache ({updater, name, limit}) {
		this.limit = limit || 10 * 1000 * 60;
		this.name = name;
		this.updater = updater;
	}

	Cache.prototype = {
		get cache() CacheStore.get(name, void 0),
		set cache(value) CacheStore.set(name, value),

		get: function(callback){ // {{{
			let self = this;

			if (this.isExpired || !this.cache) {
				this.lastUpdated = new Date().getTime();
				this.update(true, callback);
				return;
			}

			callback(this.cache);
		}, // }}}

		update: function(force, callback){ // {{{
			if (!force && !this.isExpired)
				return;

			let self = this;

			liberator.log('[ReadItLater] cache updating');
			this.updater(function(data){
				self.cache = data;
				if (callback) callback(data);
			});
		}, //}}}

		save: function() CacheStore.save(),

		get isExpired() (!this.lastUpdated || (new Date().getTime() > (this.lastUpdated + this.limit)))
	};
  // }}}

	let ReadItLater = {
		api_key : (liberator.globalVariables.readitlater_api_key) ? liberator.globalVariables.readitlater_api_key : "966T6ahYgb081icU10d44byL31p5bF20" ,

		text : function(){ // {{{

		let req = new libly.Request(
			"https://text.readitlaterlist.com/v2/text" , // url
			null, // headers
			{ // options
			asynchronous:true,
			postBody:getParameterMap(
				{
				apikey   : this.api_key,
				url      : buffer.URL,
				mode     : "less",
				images   : 0,
				}
			)
			}

		);

		req.addEventListener("onSuccess",function(data){
			e(data.responseText)
		});

		req.addEventListener("onFailure",function(data){
			liberator.echoerr(data.statusText);
			liberator.echoerr(data.responseText);
		});

		req.post();

		}, // }}}

		get : function(callback){ // {{{
		// document => http://readitlaterlist.com/api/docs#get

		let manager = Components.classes["@mozilla.org/login-manager;1"].getService(Components.interfaces.nsILoginManager);
		let logins = manager.findLogins({},"http://readitlaterlist.com","",null);

		let req = new libly.Request(
			"https://readitlaterlist.com/v2/get" , // url
			null, // headers
			{ // options
			asynchronous:true,
			postBody:getParameterMap(
				{
				apikey    : this.api_key,
				username  : encodeURIComponent(logins[0].username),
				password  : encodeURIComponent(logins[0].password),
				format    : "json",
				count     : (liberator.globalVariables.readitlater_get_count? liberator.globalVariables.readitlater_get_count : 50 ),
				//state   : (args["read"]) ? "read" : "unread",
				//tags    : (args["tags"]) ? 1 : 0,
				//myAppOnly: (args["myAppOnly"]) ? 1 : 0,
				}
			)
			}

		);

		req.addEventListener("onSuccess",function(data) callback(libly.$U.evalJson(data.responseText)));
		req.addEventListener("onFailure",function(data){
			liberator.echoerr(data.statusText);
			liberator.echoerr(data.responseText);
		});

		req.post();

		}, // }}}

		add : function(url,title,callback){ // {{{

		let manager = Components.classes["@mozilla.org/login-manager;1"].getService(Components.interfaces.nsILoginManager);
		let logins = manager.findLogins({},"http://readitlaterlist.com","",null);
		let req = new libly.Request(
			"https://readitlaterlist.com/v2/add" , // url
			null, // headers
			{ // options
			asynchronous:true,
			postBody:getParameterMap(
				{
				apikey    : this.api_key,
				username  : encodeURIComponent(logins[0].username),
				password  : encodeURIComponent(logins[0].password),
				url       : encodeURIComponent(url),
				title     : encodeURIComponent(title),
				}
			)
			}

		);

		req.addEventListener("onSuccess",callback);

		req.addEventListener("onFailure",function(data){
			liberator.echoerr(data.statusText);
			liberator.echoerr(data.responseText);
		});

		req.post();

		}, // }}}

		send : function(urls, callback) { //{{{
		// http://readitlaterlist.com/api/docs/#send

		let manager = Components.classes["@mozilla.org/login-manager;1"].getService(Components.interfaces.nsILoginManager);
		let logins = manager.findLogins({},"http://readitlaterlist.com","",null);

		function make_read_list(args){
			let o = {};
			for (let i = 0; i < args.length; i++) {
				o[i] = {"url":encodeURIComponent(args[i])};
			};
			return JSON.stringify(o);
		}

		let req = new libly.Request(
			"https://readitlaterlist.com/v2/send" , // url
			null, // headers
			{ // options
				asynchronous:true,
				postBody:getParameterMap(
					{
					apikey    : this.api_key,
					username  : encodeURIComponent(logins[0].username),
					password  : encodeURIComponent(logins[0].password),
					read      : make_read_list(urls),
					}
				)
			}
		);

		var ref = this;
		req.addEventListener("onSuccess",callback);

		req.addEventListener("onFailure",function(data){
			liberator.echoerr(data.statusText);
			liberator.echoerr(data.responseText);
		});

	liberator.log(urls)
		req.post();


		}, // }}}

		stats : function(){ // {{{

		let manager = Components.classes["@mozilla.org/login-manager;1"].getService(Components.interfaces.nsILoginManager);
		let logins = manager.findLogins({},"http://readitlaterlist.com","",null);
		let req = new libly.Request(
			"https://readitlaterlist.com/v2/stats" , // url
			null, // headers
			{ // options
				asynchronous:true,
				postBody:getParameterMap(
					{
					apikey    : this.api_key,
					username  : encodeURIComponent(logins[0].username),
					password  : encodeURIComponent(logins[0].password),
					format    : "json",
					}
				)
			}

		);

		req.addEventListener("onSuccess",function(data){
			let res = libly.$U.evalJson(data.responseText);
			liberator.echo(
			<style type="text/css"><![CDATA[
				div.stats{font-weight:bold;text-decoration:underline;color:gold;padding-left:1em;line-height:1.5em;}
			]]></style> +
			<div>#ReadItLater Stats</div> +
			<div class="stats">
				since : {unixtimeToDate(res.user_since)} <br />
				list : {res.count_list} <br />
				unread : {res.count_unread} <br />
				read : {res.count_read} <br />
			</div>
			);
		});

		req.addEventListener("onFailure",function(data){
			liberator.echoerr(data.statusText);
			liberator.echoerr(data.responseText);
		});

		req.post();

		}, // }}}

		apiTest : function(){ // {{{

		let req = new libly.Request(
			"https://readitlaterlist.com/v2/api" , // url
			null, // headers
			{ // options
			asynchronous:true,
			postBody:getParameterMap(
				{
				apikey  : this.api_key,
				}
			)
			}

		);

		req.addEventListener("onSuccess",function(data){
			liberator.echo(
			<div>
				X-Limit-User-Limit : {data.transport.getResponseHeader("X-Limit-User-Limit")} <br />
				X-Limit-User-Remaining : {data.transport.getResponseHeader("X-Limit-User-Remaining")} <br />
				X-Limit-User-Reset : {data.transport.getResponseHeader("X-Limit-User-Reset")} <br />
				X-Limit-Key-Limit : {data.transport.getResponseHeader("X-Limit-Key-Limit")} <br />
				X-Limit-Key-Remaining : {data.transport.getResponseHeader("X-Limit-Key-Remaining")} <br />
				X-Limit-Key-Reset : {data.transport.getResponseHeader("X-Limit-Key-Reset")} <br />

			</div>
			);
		});

		req.addEventListener("onFailure",function(data){
			liberator.echoerr(data.statusText);
			liberator.echoerr(data.responseText);
		});

		req.post();

		}, // }}}

	}

	let ListCache = new Cache({name: 'list', updater: ReadItLater.get.bind(ReadItLater)}); // {{{
	ListCache.remove = function(url){
		if (!this.cache)
			return this.udpate(true);
		let names = [n for ([n, v] in Iterator(this.cache.list)) if (v.url == url)];
		for (let [, name] in Iterator(names))
			delete this.cache.list[name];
		this.save();
		this.update();
	}; // }}}

	function markAsRead(urls){ // {{{
		for (let [, url] in Iterator(urls))
			ListCache.remove(url);
		ReadItLater.send(urls, echo.bind(null, "Mark as read: " + urls.length));
	} // }}}

	function addItemByArgs(args){ // {{{
		let url = args["url"] || buffer.URL;
		let title = args["title"] || buffer.title;
		ReadItLater.add(url, title,function(){
			echo("Added: " + title)
			ListCache.update(true);
		});
	} // }}}

	function echo(msg){ // {{{
		liberator.echo("[ReadItLater] " + msg);
	} // }}}

	function listCompleter(context,args){ // {{{

		function sortDate(store){
			let ary = [];
			for (let s in store){
				ary.push([s[1].time_updated,s[1]]); // 更新日でソート
			}
			ary.sort(function(a,b){return -(a[0] - b[0])});
			return ary;
		}

		context.title = ["url","title"]
		context.filters = [CompletionContext.Filter.textDescription]; // titleも補完対象にする
		context.compare = void 0;
		context.anchored = false;
		context.incomplete = true;

		ListCache.get(function(data){
			context.completions = [
				[item.url,item.title]
				for([, item] in Iterator(data.list))
				if(
					!args.some(function (arg) arg == item.url)
					&&
					(!args["bang"] ?  item.state == 0 : item.state == 1)
				)
			];
			context.incomplete = false;
		});

	} //}}}

	function unixtimeToDate(ut) { // {{{
		var t = new Date( ut * 1000 );
		t.setTime( t.getTime() + (60*60*1000 * 9) ); // +9は日本のタイムゾーン
		return t;
	} // }}}

	function getParameterMap(parameters){ // {{{
		let map = "";
		for (let key in parameters){
			if (map) map += "&";
			map += key + "=" + parameters[key];
		}
		return map
	} // }}}

  function countObjectValues(obj){ // {{{
    return [1 for (_ in Iterator(obj))].length;
  } // }}}

	// for debug {{{
	function e(v,c){
		if(c) util.copyToClipboard(v);
		liberator.log(v,-1)
	} // }}}

	// Export {{{
	__context__.ListCache = ListCache;
	__context__.API = ReadItLater;
	// }}}

})();

