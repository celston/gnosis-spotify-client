require([
	'$api/models',
	'$views/list#List'
], function(models, List) {
	'use strict';

	var foo = function() {
		$.getJSON('http://findgnosis.com/lastfm/library/artists/celston/json', {}, function (data) {
			var artist_rows = '';
			for (var i = 0; i < data.artists.length; i++) {
				var artist = data.artists[i];
				artist_rows += '<tr><td>' + (i + 1) + '</td><td><a href="spotify:search:artist:' + encodeURIComponent(artist.name) + '">' + artist.name + '</a></td><td>' + artist.playcount + '</td></tr>';
			}
			$('table#artists tbody').append(artist_rows);
		});

		$.getJSON('http://findgnosis.com/playlist/20', {}, function (data) {
			$('#playlist-loading').show();
			$('#playlist-active').hide();
			var tracks = new Array();
			for (var i = 0; i < data.playlist.length; i++) {
				tracks[i] = models.Track.fromURI(data.playlist[i]);
			}
			models.Playlist.createTemporary('My First Temporary Playlist').done(function(playlist) {
				console.log(playlist);
				playlist.load('tracks').done(function (playlist2) {
					console.log(playlist2);
					playlist2.tracks.clear().done(function() {
						playlist2.tracks.add(tracks).done(function (playlist4) {
							var list = List.forPlaylist(playlist4);
							document.getElementById('playlist-active').appendChild(list.node);
							$('#playlist-loading').hide();
							$('#playlist-active').show();
							list.init();
						});
					});
		
				});
			});
		});
	};

	exports.foo = foo;
});
