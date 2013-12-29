require([
	'$api/models',
	'$views/list#List',
	'$api/search#Search',
	'$api/library#Library'
], function(models, List, search, library) {
	'use strict';

	var globalSearch = search;
	var trackIndex = {};
	var remoteData = getLocalStorage('remoteData') || new Array();
	remoteData.forEach(function (element) {
		element.accessed = new Date(element.accessed);
		element.expires = new Date(element.expires);
	});
	console.log(remoteData);

	var libraryArtistNewTracksRatio = 0.2;
	var lastfmUser = 'celston';
	var libraryArtistTrackHashes = {};

	document.getElementById('go').addEventListener('click', function() {
		initTrackIndex(function () {
			models.Playlist.fromURI('spotify:user:123020586:playlist:1UtI7wUai37wgQbsW8SANC').load('tracks').done(function (playlist) {
				snapshotAndLoadAll(playlist.tracks, function (loadedTracks) {
					var aggregateSimilarTracks = {};
					var used = {};

					loadedTracks.forEach(function(track) {
						var normalizedArtistName = normalizeArtistName(track.artists[0].name);
						var normalizedTrackName = normalizeTrackName(track.name);
						if (!used.hasOwnProperty(normalizedArtistName)) {
							used[normalizedArtistName] = new Array();
						}
						used[normalizedArtistName].push(normalizedTrackName);
					});

					processQueue(
						loadedTracks,
						function (seedTrack, successCallback, failureCallback) {
							loadLastfmTrackSimilar(seedTrack.artists[0].name, seedTrack.name, function (similarTracks) {
								similarTracks.slice(0, 20).forEach(function (similarTrack) {
									var normalizedArtistName = normalizeArtistName(similarTrack[1]);
									var normalizedTrackName = normalizeTrackName(similarTrack[0]);

									if (!used.hasOwnProperty(normalizedArtistName) || used[normalizedArtistName].indexOf(normalizedTrackName) == -1) {
										var key = similarTrack[0] + '|' + similarTrack[1];
										if (!aggregateSimilarTracks.hasOwnProperty(key)) {
											aggregateSimilarTracks[key] = 0;
										}
										aggregateSimilarTracks[key] += similarTrack[2];
									}
								});
								successCallback();
							});
						},
						function () {
							console.log(aggregateSimilarTracks);
							processQueue(
								Object.keys(aggregateSimilarTracks),
								function (track, successCallback, failureCallback) {
									var temp = track.split('|');
									loadLastfmLibraryTracks('celston', temp[1], function (libraryArtistTracks) {
										var normalizedTrackName = normalizeTrackName(temp[0]);
										if (libraryArtistTracks.hasOwnProperty(normalizedTrackName)) {
											aggregateSimilarTracks[track] *= libraryArtistTracks[normalizedTrackName];
										}
										else {
											delete aggregateSimilarTracks[track];
										}
										successCallback();
									});
								},
								function () {
									console.log(aggregateSimilarTracks);
									var topAggregateSimilarTracks = getTopKeys(aggregateSimilarTracks, 100);
									console.log(topAggregateSimilarTracks);
									var d = new Date();
									createAndLoadTemporaryPlaylist(d.toString(), function (loadedPlaylist) {
										processQueue(
											topAggregateSimilarTracks,
											function (track, successCallback, failureCallback) {
												console.log(track);
												var temp = track.split('|');
												findSpotifyTracks(
													normalizeArtistName(temp[1]),
													normalizeTrackName(temp[0]),
													function (spotifyTracks) {
														spotifyTracks.forEach(function (spotifyTrack) {
															loadedPlaylist.tracks.add(spotifyTrack);
														});
														successCallback();
													},
													function () {
														console.log('FAIL: ' + temp[1] + ' - ' + temp[0]);
														successCallback();
													}
												);
											},
											function () {
												console.log('*** DONE ***');
												var list = List.forPlaylist(loadedPlaylist);
												document.getElementById('playlist').appendChild(list.node);
												list.init();
												console.log(remoteData);
												saveRemoteData();
											}
										);
									});
								}
							);
						}
					);
				});
			});
			/*
			createAndLoadPlaylist('Top 10% Artists, Top 50% Tracks', function (loadedPlaylist) {
				loadLastfmUserArtists('celston', function (userArtists) {
					var artistHash = buildHashFromObjectProperties(getTopPercentile(userArtists, 0.1), 100);
		
					repeat(
						5000,
						function (successCallback, failureCallback) {
							var artistName = wrand(artistHash);
							loadLastfmLibraryTracks('celston', artistName, function (libraryArtistTracks) {
								var trackNames = Object.keys(libraryArtistTracks);
								trackNames.forEach(function (trackName) {
									if (libraryArtistTracks[trackName] == 0) {
										delete libraryArtistTracks[trackName];
									}
								});
								var trackHash = buildHashFromObjectProperties(getTopPercentile(libraryArtistTracks, 0.5));
								var trackName = wrand(trackHash);
								findSpotifyTracks(
									normalizeArtistName(artistName),
									trackName,
									function (spotifyTracks) {
										var spotifyTrackHash = buildSpotifyTrackHash(spotifyTracks);
										var spotifyTrack = wrand(spotifyTrackHash);
										spotifyTrackHash = null;
										loadedPlaylist.tracks.add(spotifyTrack);
										successCallback();
									},
									function () {
										console.log('FAIL: ' + artistName + ' - ' + trackName);
										failureCallback();
									}
								);
							});
						},
						function () {
							console.log('*** DONE ***');
						}
					);
				});
			});
			createAndLoadPlaylistWithDateName(function (loadedPlaylist) {
				populatePlaylistWithUnderListenedArtists(loadedPlaylist, function () {
					populatePlaylistWithSimilarArtists(loadedPlaylist, 1000, function() {
						populatePlaylistWithRecentArtists(loadedPlaylist, function() {
							console.log('*** DONE ***');
						});
					});
				});
			});
			*/
		});
	});

	function loadLastfmTrackSimilar(artistName, trackName, callback) {
		loadData('lastfm/track/similar/'+urlSafeArtistName(artistName)+'/'+trackName.toLowerCase(), 7, callback);
	}

	function populatePlaylistWithUnderListenedArtists(loadedPlaylist, doneCallback) {
		loadLastfmUserRecenttracks(lastfmUser, 5000, function (userRecentTracks) {
			loadLastfmUserArtists(lastfmUser, function (userArtists) {
				console.log(userRecentTracks);
				console.log(userArtists);
				var recentArtists = {};
				for (var artistName in userRecentTracks) {
					recentArtists[artistName] = 0;
					for (var trackName in userRecentTracks[artistName]) {
						recentArtists[artistName] += userRecentTracks[artistName][trackName];
					}
				}

				var rankings = {};

				for (var artistName in userArtists) {
					if (recentArtists.hasOwnProperty(artistName)) {
						rankings[artistName] = Math.ceil(userArtists[artistName] / recentArtists[artistName]);
					}
					else {
						rankings[artistName] = userArtists[artistName] * 2;
					}
				}

				var topRankings = getTopPercentile(rankings, 0.1);
				var artistHash = buildHashFromObjectProperties(getTopPercentile(rankings, 0.1), 100);
				repeat(
					1000,
					function (successCallback, failureCallback) {
						var artistName = wrand(artistHash);
						loadLastfmLibraryTracks('celston', artistName, function (libraryArtistTracks) {
							var trackNames = Object.keys(libraryArtistTracks);
							trackNames.forEach(function (trackName) {
								if (libraryArtistTracks[trackName] == 0) {
									delete libraryArtistTracks[trackName];
								}
							});
							var trackHash = buildHashFromObjectProperties(getTopPercentile(libraryArtistTracks, 0.5));
							var trackName = wrand(trackHash);
							findSpotifyTracks(
								normalizeArtistName(artistName),
								trackName,
								function (spotifyTracks) {
									var spotifyTrackHash = buildSpotifyTrackHash(spotifyTracks);
									var spotifyTrack = wrand(spotifyTrackHash);
									spotifyTrackHash = null;
									loadedPlaylist.tracks.add(spotifyTrack);
									successCallback();
								},
								function () {
									console.log('FAIL: ' + artistName + ' - ' + trackName);
									failureCallback();
								}
							);
						});
					},
					doneCallback
				);
			});
		});
	}

	function loadLastfmUserArtists(user, callback) {
		loadData('lastfm/user/artists/' + user, 1, callback);
	}

	function getTopPercentile(original, percentile) {
		return getTop(original, Math.ceil(Object.keys(original).length * percentile));
	}
	
	function getTop(original, count) {
		var result = {};
		
		getTopKeys(original, count).forEach(function (key) {
			result[key] = original[key];
		});
		
		return result;
	}

	function getTopKeys(original, count) {
		var keys = Object.keys(original).sort(function (a, b) { return new Number(original[b]) - new Number(original[a]); });

		return keys.slice(0, count);
	}

	function loadLastfmArtistSimilar(artist, callback) {
		loadData('lastfm/artist/similar/'+urlSafeArtistName(artist), 7, callback);
	}

	function populatePlaylistWithRecentArtists(loadedPlaylist, doneCallback) {
		loadLastfmUserRecenttracks(lastfmUser, 5000, function (userRecentTracks) {
			var userRecentArtistsHash = buildUserRecentArtistsHash(userRecentTracks);
			repeat(
				5000,
				function (successCallback, failureCallback) {
					var randomArtistName = wrand(userRecentArtistsHash);
					loadLibraryArtistTrackHashes(randomArtistName, function (libraryArtistTrackHash) {
						var randomTrackName = wrand(libraryArtistTrackHash);
						findSpotifyTracks(
							normalizeArtistName(randomArtistName),
							randomTrackName,
							function (spotifyTracks) {
								var spotifyTrackHash = buildSpotifyTrackHash(spotifyTracks);
								var spotifyTrack = wrand(spotifyTrackHash);
								spotifyTrackHash = null;
								loadedPlaylist.tracks.add(spotifyTrack);
								successCallback();
							},
							function () {
								console.log('FAIL: ' + randomArtistName + ' - ' + randomTrackName);
								failureCallback();
							}
						);
					});
				},
				doneCallback	
			);
		});
	}

	function loadLibraryArtistTrackHashes(libraryArtistName, callback) {
		if (libraryArtistTrackHashes.hasOwnProperty(libraryArtistName)) {
			callback(libraryArtistTrackHashes[libraryArtistName]);
		}
		else {
			loadLastfmLibraryTracks(lastfmUser, libraryArtistName, function (libraryArtistTracks) {
				var libraryArtistTrackCount = Object.keys(libraryArtistTracks).length;
				console.log('"' + libraryArtistName + '" Track Count: ' + libraryArtistTrackCount);
				var libraryArtistTrackNames = Object.keys(libraryArtistTracks);
				var libraryArtistTrackHash = buildHashFromObjectProperties(libraryArtistTracks, 100);
				loadLastfmArtistTracks(libraryArtistName, 400, function (artistTracks) {
					var libraryArtistNewTrackHash = {};
				
					for (var artistTrackName in artistTracks) {
						if (libraryArtistTrackNames.indexOf(artistTrackName) == -1) {
							var key = artistTracks[artistTrackName];
							var found = false;
							while (!found) {
								if (!libraryArtistNewTrackHash.hasOwnProperty(key)) {
									libraryArtistNewTrackHash[key] = artistTrackName;
									found = true;
								}
								else {
									key += 1;
								}
							}
						}
					}
					
					var libraryArtistNewTrackCount = 0;
					if (libraryArtistTrackCount < 10) {
						libraryArtistNewTrackCount = 5;
					}
					else {
						libraryArtistNewTrackCount = Math.ceil(libraryArtistNewTracksRatio * libraryArtistTrackCount);
					}
					console.log('"' + libraryArtistName + '" New Track Count: ' + libraryArtistNewTrackCount);
	
					var libraryArtistNewTrackNames = new Array();
					for (var i = 0; i < libraryArtistNewTrackCount; i++) {
						var libraryArtistNewTrackName = wrand(libraryArtistNewTrackHash);
						if (!libraryArtistTrackHash.hasOwnProperty(libraryArtistNewTrackName)) {
							addToHash(libraryArtistTrackHash, 0, libraryArtistNewTrackName, 100);
							libraryArtistNewTrackNames.push(libraryArtistNewTrackName);
						}
					}
	
					console.log('"' + libraryArtistName + '" New Tracks: ' + libraryArtistNewTrackNames.join(','));

					libraryArtistTrackHashes[libraryArtistName] = libraryArtistTrackHash;
					callback(libraryArtistTrackHash);
				});
			});
		}
	}

	function buildUserRecentArtistsHash(userRecentTracks) {
		return buildHash(
			Object.keys(userRecentTracks),
			function (userRecentArtist) {
				var result = 0;
				for (var userRecentTrackName in userRecentTracks[userRecentArtist]) {
					result += userRecentTracks[userRecentArtist][userRecentTrackName];
				}

				return result;
			},
			100
		);
	}

	function loadLastfmUserRecenttracks(user, count, callback) {
		loadData('lastfm/user/recenttracks/'+user+'/'+count, 1, callback);
	}

	function loadLastfmArtistTracks(artist, count, callback) {
		loadData('lastfm/artist/tracks/'+urlSafeArtistName(artist)+'/'+count, 1, callback);
	}

	function createPlaylistFromArtist(artist, n) {
		createAndLoadPlaylistWithDateName(function (loadedPlaylist) {
			populatePlaylistFromArtist(loadedPlaylist, artist, n, function() {});
		});
	}

	function loadLastfmLibraryTracks(user, artist, callback) {
		loadData('lastfm/library/tracks/celston/'+urlSafeArtistName(artist), 1, callback);
	}

	function populatePlaylistFromArtist(loadedPlaylist, artist, n, mainCallback) {
		loadLastfmLibraryTracks('celston', artist, function (artistLibraryTracks) {
			console.log(artistLibraryTracks);
			var hash = buildHashFromObjectProperties(artistLibraryTracks, 1000);
			console.log(hash);
			var normalizedArtistName = normalizeArtistName(artist);

			repeat(
				n,
				function (successCallback, failureCallback) {
					var normalizedTrackName = wrand(hash);
					findSpotifyTracks(
						normalizedArtistName,
						normalizedTrackName,
						function (spotifyTracks) {
							var spotifyTrackHash = buildSpotifyTrackHash(spotifyTracks);
							var spotifyTrack = wrand(spotifyTrackHash);
							spotifyTrackHash = null;
							loadedPlaylist.tracks.add(spotifyTrack);
							successCallback();
						},
						function () {
							console.log('FAIL: ' + normalizedTrackName);
							failureCallback();
						}
					);
				},
				function () {
					console.log('*** POPULATE(' + artist + ') DONE ***');
					hash = null;
					mainCallback();
				}
			);
		});
	}

	function repeat(n, processCallback, completedCallback) {
		if (n > 0) {
			processCallback(
				function () {
					repeat(n-1, processCallback, completedCallback);
				},
				function () {
					console.log('retry');
					repeat(n, processCallback, completedCallback);
				}
			);
		}
		else {
			if (typeof completedCallback != 'undefined') {
				completedCallback();
			}
		}
	}

	function populatePlaylistWithSimilarArtists(loadedPlaylist, n, doneCallback) {
		loadLastfmUserRecenttracks(lastfmUser, 5000, function (groupedTracks) {
			var seedArtists = new Array();
			var seedArtistNames = new Array();
			for (var artistName in groupedTracks) {
				var obj = { name: artistName, count: 0 };
				for (var trackName in groupedTracks[artistName]) {
					obj.count += groupedTracks[artistName][trackName];
				}
				seedArtists.push(obj);
				seedArtistNames.push(artistName);
			}
	
			var aggregateSimilarArtists = {};
			processQueue(
				seedArtists,
				function (artist, successCallback, failureCallback) {
					loadLastfmArtistSimilar(artist.name, function (similarArtists) {
						for (var similarArtistName in similarArtists) {
							if (seedArtistNames.indexOf(similarArtistName) == -1) {
								if (!aggregateSimilarArtists.hasOwnProperty(similarArtistName)) {
									aggregateSimilarArtists[similarArtistName] = 0;
								}
								aggregateSimilarArtists[similarArtistName] += similarArtists[similarArtistName] * artist.count;
							}
						}
						successCallback();
					});
				},
				function () {
					var topAggregateSimilarArtists = getTop(aggregateSimilarArtists, 1000);
					var aggregateSimilarArtistHash = buildHashFromObjectProperties(topAggregateSimilarArtists, 10000);
					console.log(aggregateSimilarArtistHash);
					repeat(
						n,
						function (successCallback, failureCallback) {
							var randomArtistName = wrand(aggregateSimilarArtistHash);
							loadLibraryArtistTrackHashes(randomArtistName, function (libraryArtistTrackHash) {
								var randomTrackName = wrand(libraryArtistTrackHash);
								findSpotifyTracks(
									normalizeArtistName(randomArtistName),
									randomTrackName,
									function (spotifyTracks) {
										var spotifyTrackHash = buildSpotifyTrackHash(spotifyTracks);
										var spotifyTrack = wrand(spotifyTrackHash);
										spotifyTrackHash = null;
										loadedPlaylist.tracks.add(spotifyTrack);
										successCallback();
									},
									function () {
										console.log('FAIL: ' + randomArtistName + ' - ' + randomTrackName);
										failureCallback();
									}
								);
							});
						},
						doneCallback
					);
				}
			);
		});
	}

	function urlSafeArtistName(artistName) {
		return artistName.toLowerCase().replace('/', '');
	}

	function loadData(path, expireDays, callback) {
		if (isNaN(expireDays)) {
			console.log('Bad expire days for ' + path + ' (' + expireDays + ')');
		}
		var found = false;
		var data = null;
		var now = new Date();

		remoteData.forEach(function (element) {
			if (!found) {
				if (element.path == path) {
					found = true;
					data = element.data;
					element.accessed = new Date();
				}
			}
		});

		if (found) {
			callback(data);
		}
		else {
			$.ajax('http://findgnosis.com/' + path, {
				success: function(data) {
					var expires = new Date();
					expires.setDate(expires.getDate() + expireDays);

					var element = {
						path: path,
						data: data.result,
						accessed: new Date(),
						expires: expires
					};
					remoteData.unshift(element);

					callback(data.result);
				},
				error: function () {
					callback({});
				}
			});
		}
	}

	function saveRemoteData() {
		var now = new Date();
		remoteData = remoteData.filter(function (element) {
			if (typeof element.expires != 'undefined') {
				if (element.expires > now) {
					return true;
				}
				console.log(element.path + ' is expired (' + element.expires + ')');
			}
			console.log(element.path + ' will be removed');
			return false;
		});

		remoteData.sort(function (a, b) {
			return b.accessed.getTime() - a.accessed.getTime();
		});

		var saved = false;
		while (!saved) {
			try {
				setLocalStorage('remoteData', remoteData);
				saved = true;
			}
			catch (err) {
				console.log('ERROR');
				console.log(err);
				remoteData.pop();
			}
		}
	}

	function setLocalStorage(key, obj) {
		if (localStorage.setObject === 'function') {
			localStorage.setObject(key, obj);
		}
		else {
			localStorage.setItem(key, JSON.stringify(obj));
		}
	}

	function getLocalStorage(key) {
		var record = localStorage.getItem(key);

		if (record !== null) {
			if (typeof record === 'string') {
				record = JSON.parse(record);
				return record;
			}
			return record;
		}

		return null;
	}

	function processQueue(queue, processCallback, completedCallback) {
		if (queue.length > 0) {
			processCallback(
				queue[0],
				function () {
					queue.shift();
					processQueue(queue, processCallback, completedCallback);
				},
				function () {
					console.log('retry');
					processQueue(queue, processCallback, completedCallback);
				}
			);
		}
		else {
			completedCallback();
		}
	}

	function buildSpotifyTrackHash(tracks) {
		return buildHash(tracks, createSpotifyTrackHashKeyCallback(tracks), 2);
	}

	function createSpotifyTrackHashKeyCallback(tracks) {
		var avgPopularity = avg(tracks.filter(function (track) { return track.popularity != 0; }).map(function (track) { return track.popularity; }));
		if (avgPopularity < 10) {
			avgPopularity = 50;
		}

		return function (track) { return track.popularity == 0 ? avgPopularity : track.popularity; } 
	}

	function sum(list) {
		if (list.length == 0) {
			return 0;
		}
		return list.reduce(function (previousValue, currentValue) { return previousValue + currentValue; });
	}

	function avg(list) {
		return sum(list) / list.length;
	}

	function buildHashFromObjectProperties(obj, scale) {
		if (isNaN(scale)) {
			scale = 2;
		}
		if (scale < 2) {
			scale = 2;
		}
		//console.log('buildHashFromObjectProperties: ' + scale);
		var hash = {};

		for (var property in obj) {
			var key = obj[property] * scale;
			addToHash(hash, Math.round(obj[property] * scale), property, scale);
		}

		return hash;
	}

	function addToHash(hash, key, value, scale) {
		if (isNaN(key)) {
			key = 0;
		}
		var found = false;
		while (!found) {
			if (!hash.hasOwnProperty(key)) {
				hash[key] = value;
				found = true;
			}
			else {
				key += rand(1, scale);
			}
		}
	}

	function buildHash(objects, keyCallback, scale) {
		//console.log('buildHash: ' + scale);
		var hash = {};
		if (isNaN(scale)) {
			scale = 2;
		}
		if (scale < 2) {
			scale = 2;
		}

		objects.forEach(function (obj) {
			addToHash(hash, keyCallback(obj) * scale, obj, scale);
		});

		return hash;
	}

	function findSpotifyTracks(normalizedArtistName, normalizedTrackName, successCallback, failureCallback) {
		//console.log('findSpotifyTracks(' + normalizedArtistName + ', ' + normalizedTrackName + ')');
		if (trackIndex.hasOwnProperty(normalizedArtistName)) {
			if (trackIndex[normalizedArtistName].hasOwnProperty(normalizedTrackName)) {
				successCallback(trackIndex[normalizedArtistName][normalizedTrackName]);
			}
			else {
				searchSpotifyTracks(normalizedArtistName, normalizedTrackName, successCallback, failureCallback);
			}
		}
		else {
			searchSpotifyTracks(normalizedArtistName, normalizedTrackName, successCallback, failureCallback);
		}
	}

	function searchSpotifyTracks(normalizedArtistName, normalizedTrackName, successCallback, failureCallback) {
		var query = normalizedArtistName + ' ' + normalizedTrackName;
		//console.log(query);
		search.search(query).tracks.snapshot().done(function (searchTracksSnapshot) {
			searchTracksSnapshot.loadAll().done(function (loadedSearchTracks) {
				loadedSearchTracks.forEach(function (track) {
					var curTrackName = normalizeTrackName(track.name);
					for (var j = 0; j < track.artists.length; j++) {
						var curArtistName = normalizeArtistName(track.artists[j].name);
						if (!trackIndex.hasOwnProperty(curArtistName)) {
							trackIndex[curArtistName] = {};
						}
						if (!trackIndex[curArtistName].hasOwnProperty(curTrackName)) {
							trackIndex[curArtistName][curTrackName] = new Array();
						}
						trackIndex[curArtistName][curTrackName].push(track);
					}
				});
	
				if (trackIndex.hasOwnProperty(normalizedArtistName)) {
					if (trackIndex[normalizedArtistName].hasOwnProperty(normalizedTrackName)) {
						successCallback(trackIndex[normalizedArtistName][normalizedTrackName]);
					}
					else {
						failureCallback();
					}
				}
				else {
					failureCallback();
				}
			});
		})
		.fail(function (a, b, c) {
			console.log(a);
			console.log(b);
			console.log(c);
			failureCallback();
		});
	}

	function initTrackIndex(callback) {
		loadSnapshotAndLoadAll(library.forCurrentUser().tracks, function (loadedLibraryTracks) {
			for (var i = 0; i < loadedLibraryTracks.length; i++) {
				var track = loadedLibraryTracks[i];
				if (track.playable) {
					var curTrackName = normalizeTrackName(track.name);
					for (var j = 0; j < track.artists.length; j++) {
						var curArtistName = normalizeArtistName(track.artists[j].name);
						if (!trackIndex.hasOwnProperty(curArtistName)) {
							trackIndex[curArtistName] = {};
						}
						if (!trackIndex[curArtistName].hasOwnProperty(curTrackName)) {
							trackIndex[curArtistName][curTrackName] = new Array();
						}
						trackIndex[curArtistName][curTrackName].push({
							uri: track.uri,
							popularity: track.popularity
						});
					}
				}
			}
			callback();
		});
	}

	function loadSnapshotAndLoadAll(obj, callback) {
		obj.load().done(function (obj2) {
			snapshotAndLoadAll(obj2, callback);
		});
	}

	function snapshotAndLoadAll(obj, callback) {
		obj.snapshot().done(function (snapshot) {
			snapshot.loadAll().done(callback);
		});
	}

	function normalizeArtistName(name) {
		name = name.toUpperCase().trim();
	
		name = name.replace(/^\W+/, '');
		name = name.replace(/&/, 'AND');
		name = name.replace(/^THE /, '');
	
		name = name.trim();
	
		return name;
	}
	
	function normalizeTrackName(name) {
		name = name.toUpperCase().trim();
		name = name.replace(/^\s*-\s*/, '');
		name = name.replace(/\s+\W+\s*$/, '');
		name = name.replace(/^\d\d+\.?\s+(-\s+)?(\w)/, '$2');
		name = name.replace(/^\s*-\s*/, '');
		name = name.replace(/\s+-\s+.*$/, '');
		name = name.replace(/\s*\[[^\]]+\]$/, '');
		name = name.replace(/\s*\([^\)]+\)?$/, '');
		name = name.replace(/\s*\/\s*.+$/, '');
		name = name.replace(/-+/, ' ');
		name = name.replace(/&/, 'AND');
		name = name.replace(/^THE /, '');
		name = name.replace(/^A /, '');
		name = name.replace(/\W+$/, '');
		name = name.trim();
		return name;
	}

	function wrand(data) {
		var totalw = 0;
		var curw = 0;
	
		var weights = new Array();
		for (var datum in data) {
			totalw += new Number(datum);
			weights.push(new Number(datum));
		}
		var maxWeight = max(weights);
	
		var r = rand(0, totalw);
	
		for (var datum in data) {
			curw += new Number(datum);
			if (curw > r) return data[datum];
		}
	
		return data[maxWeight];
	}

	function max(array) {
		return Math.max.apply(Math, array);
	}

	function rand(min, max) {
		return Math.floor((Math.random()*(max-min))+min)
	}

	function createAndLoadPlaylistWithDateName(callback) {
		var d = new Date();
		createAndLoadPlaylist(d.toString(), callback);
	}

	function createAndLoadPlaylist(name, callback) {
		models.Playlist.create(name).done(function (playlist) {
			models.Playlist.fromURI(playlist.uri).load('tracks').done(function (loadedPlaylist) {
				callback(loadedPlaylist)
			});
		});
	}

	function createAndLoadTemporaryPlaylist(name, callback) {
		models.Playlist.createTemporary(name).done(function (playlist) {
			models.Playlist.fromURI(playlist.uri).load('tracks').done(function (loadedPlaylist) {
				callback(loadedPlaylist)
			});
		});
	}

});
