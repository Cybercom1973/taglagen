$(document).ready(function() {
    var urlParams = new URLSearchParams(window.location.search);
    var trainNumber = urlParams.get('train');
    
    if (!trainNumber) {
        showError('Inget tågnummer angivet');
        return;
    }

    var myTrainPosition = null;
    var myTrainBearing = null;
    var myTrainSpeed = null;
    var refreshInterval = null;
    var scrollPos = 0;

    function parseDate(dateStr) {
        if (!dateStr) return null;
        return new Date(dateStr);
    }

    function getDiffMinutes(advertisedStr, actualStr) {
        var advertised = parseDate(advertisedStr);
        var actual = parseDate(actualStr);
        if (!advertised || !actual) return 0;
        return Math.round((actual - advertised) / 60000);
    }

    function formatDelay(diff) {
        if (diff <= 0) return '';
        return '+' + diff;
    }

    function formatTime(dateStr) {
        if (!dateStr) return '';
        var date = new Date(dateStr);
        return date.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
    }

    function getBestDestination(ann) {
        if (ann.ToLocation && ann.ToLocation.length > 0) {
            return ann.ToLocation[ann.ToLocation.length - 1].LocationName;
        }
        return '';
    }

    function showError(message) {
        $('#loading').hide();
        $('#error-message').text(message).show();
    }

    function showLoading(show) {
        if (show) {
            $('#loading').show();
            $('#train-table').hide();
        } else {
            $('#loading').hide();
            $('#train-table').show();
        }
    }

    function updateLastUpdate() {
        var now = new Date().toLocaleTimeString('sv-SE');
        $('#last-update').text('Uppdaterad: ' + now);
    }

    function stationLink(signature, name) {
        var displayName = name || signature;
        var encodedSign = encodeURIComponent(signature);
        return '<a href="https://search.stationen.info/station.html?sign=' + encodedSign + '" class="station-link" target="_blank">' + displayName + '</a>';
    }

    function trainLink(trainIdent, destination, delayInfo) {
        var delayClass = delayInfo.diff > 5 ? 'delayed' : (delayInfo.diff > 0 ? 'minor-delay' : 'on-time');
        var delayText = delayInfo.text ? ' <span class="' + delayClass + '">' + delayInfo.text + '</span>' : '';
        var destText = destination ? ' → ' + destination : '';
        return '<a href="train.html?train=' + encodeURIComponent(trainIdent) + '" class="train-link">' + trainIdent + destText + delayText + '</a>';
    }

    function findTrainDestination(announcements) {
        if (!announcements || announcements.length === 0) return '';
        var lastAnn = announcements[announcements.length - 1];
        return lastAnn.LocationSignature || getBestDestination(lastAnn);
    }

    function findTrainOrigin(announcements) {
        if (!announcements || announcements.length === 0) return '';
        var firstAnn = announcements[0];
        if (firstAnn.FromLocation && firstAnn.FromLocation.length > 0) {
            return firstAnn.FromLocation[0].LocationName;
        }
        return firstAnn.LocationSignature;
    }

    function buildRoute(announcements) {
        var stations = [];
        var seen = {};
        
        announcements.forEach(function(ann) {
            if (!seen[ann.LocationSignature]) {
                seen[ann.LocationSignature] = true;
                stations.push({
                    signature: ann.LocationSignature,
                    announcements: []
                });
            }
            var station = stations.find(function(s) { return s.signature === ann.LocationSignature; });
            station.announcements.push(ann);
        });
        
        return stations;
    }

    function isTrainSameDirection(otherBearing) {
        if (myTrainBearing === null || otherBearing === null) {
            return null;
        }
        var diff = Math.abs(myTrainBearing - otherBearing);
        if (diff > 180) diff = 360 - diff;
        return diff < 90;
    }

    function getNestedValue(obj, path) {
        var parts = path.split('.');
        var current = obj;
        for (var i = 0; i < parts.length; i++) {
            if (current === null || current === undefined) return undefined;
            current = current[parts[i]];
        }
        return current;
    }

    function loadTrainData() {
        scrollPos = $(window).scrollTop();
        
        TrafikverketAPI.getTrainAnnouncements(trainNumber)
            .then(function(annResponse) {
                var result = annResponse.RESPONSE && annResponse.RESPONSE.RESULT && annResponse.RESPONSE.RESULT[0];
                var announcements = (result && result.TrainAnnouncement) || [];
                
                if (announcements.length === 0) {
                    showError('Tåg ' + trainNumber + ' hittades inte');
                    return;
                }

                return TrafikverketAPI.getTrainPosition(trainNumber)
                    .then(function(posResponse) {
                        var posResult = posResponse.RESPONSE && posResponse.RESPONSE.RESULT && posResponse.RESPONSE.RESULT[0];
                        var positions = (posResult && posResult.TrainPosition) || [];
                        
                        if (positions.length > 0) {
                            var pos = positions[0];
                            myTrainPosition = getNestedValue(pos, 'Position.WGS84');
                            myTrainBearing = pos.Bearing;
                            myTrainSpeed = pos.Speed;
                            
                            if (myTrainSpeed !== null && myTrainSpeed !== undefined) {
                                $('#train-speed').text('🚄 ' + myTrainSpeed + ' km/h');
                            } else {
                                $('#train-speed').text('');
                            }
                        } else {
                            myTrainPosition = null;
                            myTrainBearing = null;
                            myTrainSpeed = null;
                            $('#train-speed').text('');
                        }

                        var route = buildRoute(announcements);
                        var locationSignatures = route.map(function(s) { return s.signature; });
                        var destination = findTrainDestination(announcements);

                        $('#train-label').text('Tåg ' + trainNumber + ' → ' + destination);

                        return TrafikverketAPI.getOtherTrains(locationSignatures, trainNumber)
                            .then(function(otherResponse) {
                                var otherResult = otherResponse.RESPONSE && otherResponse.RESPONSE.RESULT && otherResponse.RESPONSE.RESULT[0];
                                var otherAnnouncements = (otherResult && otherResult.TrainAnnouncement) || [];

                                var otherTrainNumbers = [];
                                otherAnnouncements.forEach(function(a) {
                                    if (otherTrainNumbers.indexOf(a.AdvertisedTrainIdent) === -1) {
                                        otherTrainNumbers.push(a.AdvertisedTrainIdent);
                                    }
                                });

                                return TrafikverketAPI.getTrainPositions(otherTrainNumbers)
                                    .then(function(otherPosResponse) {
                                        var otherPosResult = otherPosResponse.RESPONSE && otherPosResponse.RESPONSE.RESULT && otherPosResponse.RESPONSE.RESULT[0];
                                        var otherPositions = (otherPosResult && otherPosResult.TrainPosition) || [];

                                        var positionLookup = {};
                                        otherPositions.forEach(function(p) {
                                            var trainNum = getNestedValue(p, 'Train.AdvertisedTrainNumber');
                                            if (trainNum) {
                                                positionLookup[trainNum] = p;
                                            }
                                        });

                                        var otherTrainsPerStation = {};
                                        otherAnnouncements.forEach(function(ann) {
                                            var sig = ann.LocationSignature;
                                            if (!otherTrainsPerStation[sig]) {
                                                otherTrainsPerStation[sig] = { sameDir: [], opposite: [] };
                                            }
                                            
                                            var trainId = ann.AdvertisedTrainIdent;
                                            var pos = positionLookup[trainId];
                                            var sameDir = pos ? isTrainSameDirection(pos.Bearing) : null;
                                            
                                            var delayDiff = getDiffMinutes(ann.AdvertisedTimeAtLocation, ann.EstimatedTimeAtLocation || ann.TimeAtLocation);
                                            var delayInfo = { diff: delayDiff, text: formatDelay(delayDiff) };
                                            var dest = getBestDestination(ann);
                                            
                                            var trainData = {
                                                trainId: trainId,
                                                destination: dest,
                                                delayInfo: delayInfo,
                                                time: formatTime(ann.AdvertisedTimeAtLocation),
                                                activity: ann.ActivityType,
                                                speed: pos ? pos.Speed : null
                                            };
                                            
                                            if (sameDir === true) {
                                                otherTrainsPerStation[sig].sameDir.push(trainData);
                                            } else {
                                                otherTrainsPerStation[sig].opposite.push(trainData);
                                            }
                                        });

                                        var currentStationIndex = -1;
                                        for (var i = route.length - 1; i >= 0; i--) {
                                            var station = route[i];
                                            var hasArrived = station.announcements.some(function(a) { return a.TimeAtLocation; });
                                            if (hasArrived) {
                                                currentStationIndex = i;
                                                break;
                                            }
                                        }

                                        var $tbody = $('#table-body');
                                        $tbody.empty();

                                        route.forEach(function(station, index) {
                                            var sig = station.signature;
                                            var others = otherTrainsPerStation[sig] || { sameDir: [], opposite: [] };
                                            
                                            var sameDirHtml = others.sameDir.map(function(t) { return trainLink(t.trainId, t.destination, t.delayInfo); }).join('<br>') || '-';
                                            var oppositeHtml = others.opposite.map(function(t) { return trainLink(t.trainId, t.destination, t.delayInfo); }).join('<br>') || '-';
                                            
                                            var $row = $('<tr><td>' + stationLink(sig, sig) + '</td><td>' + sameDirHtml + '</td><td>' + oppositeHtml + '</td></tr>');
                                            
                                            $tbody.append($row);
                                            
                                            if (index === currentStationIndex && index < route.length - 1) {
                                                var speedText = myTrainSpeed ? ' • ' + myTrainSpeed + ' km/h' : '';
                                                var bearingText = myTrainBearing ? ' • ' + myTrainBearing + '°' : '';
                                                var $spacer = $('<tr class="spacer-row"><td colspan="3"><span class="current-train-box">🚂 Tåg ' + trainNumber + speedText + bearingText + '</span></td></tr>');
                                                $tbody.append($spacer);
                                            }
                                        });

                                        showLoading(false);
                                        updateLastUpdate();
                                        $(window).scrollTop(scrollPos);
                                    });
                            });
                    });
            })
            .catch(function(error) {
                console.error('Fel vid laddning:', error);
                showError('Kunde inte ladda tågdata');
            });
    }

    loadTrainData();
    refreshInterval = setInterval(loadTrainData, 60000);

    $('#refresh-btn').on('click', function() {
        loadTrainData();
    });
});