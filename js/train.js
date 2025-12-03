$(document).ready(function() {
    var urlParams = new URLSearchParams(window. location.search);
    var trainNumber = urlParams.get('train');
    
    if (! trainNumber) {
        showError('Inget tågnummer angivet');
        return;
    }

    var myTrainBearing = null;
    var myTrainSpeed = null;
    var refreshInterval = null;
    var scrollPos = 0;
    var stationCoords = {};
    var isFirstLoad = true;

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
        if (diff <= 0) return { text: diff. toString(), className: 'on-time' };
        return { text: '+' + diff, className: 'delayed' };
    }

    function getBestDestination(ann) {
        if (ann.ToLocation && ann.ToLocation. length > 0) {
            return ann.ToLocation[ann.ToLocation.length - 1]. LocationName;
        }
        return '';
    }

    function showError(message) {
        $('#loading'). hide();
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
        var now = new Date(). toLocaleTimeString('sv-SE');
        $('#last-update').text('Uppdaterad: ' + now);
    }

    function stationLink(signature, name) {
        var displayName = name || signature;
        var encodedSign = encodeURIComponent(signature);
        return '<a href="https://search.stationen.info/station. html? sign=' + encodedSign + '" class="station-link" target="_blank">' + displayName + '</a>';
    }

        function trainLink(trainIdent, destination, delayInfo) {
        var delayHtml = '';
        var linkClass = 'train-link';
        
        if (delayInfo && delayInfo. text) {
            delayHtml = ' <span class="' + delayInfo.className + '">' + delayInfo. text + '</span>';
            linkClass += ' ' + delayInfo.className;
        }
        
        var destText = destination ?  ' → ' + destination : '';
        return '<a href="train. html? train=' + encodeURIComponent(trainIdent) + '" class="' + linkClass + '">' + trainIdent + destText + delayHtml + '</a>';
    }

    function findTrainDestination(announcements) {
        if (!announcements || announcements.length === 0) return '';
        var lastAnn = announcements[announcements.length - 1];
        return lastAnn.LocationSignature || getBestDestination(lastAnn);
    }

    function buildRoute(announcements) {
        var stations = [];
        var seen = {};
        
        announcements.forEach(function(ann) {
            if (!seen[ann.LocationSignature]) {
                seen[ann.LocationSignature] = true;
                stations. push({
                    signature: ann.LocationSignature,
                    announcements: [],
                    isFromOtherTrain: false
                });
            }
            var station = stations.find(function(s) { return s.signature === ann.LocationSignature; });
            station.announcements.push(ann);
        });
        
        return stations;
    }

    function parseWGS84(wgs84String) {
        if (!wgs84String) return null;
        var match = wgs84String.match(/POINT \(([^ ]+) ([^)]+)\)/);
        if (match) {
            return { lon: parseFloat(match[1]), lat: parseFloat(match[2]) };
        }
        return null;
    }

    function distanceBetween(coord1, coord2) {
        if (! coord1 || ! coord2) return Infinity;
        var dx = coord1.lon - coord2.lon;
        var dy = coord1.lat - coord2.lat;
        return Math.sqrt(dx * dx + dy * dy);
    }

    function pointToLineDistance(point, lineStart, lineEnd) {
        var dx = lineEnd.lon - lineStart.lon;
        var dy = lineEnd.lat - lineStart.lat;
        var lineLengthSq = dx * dx + dy * dy;
        
        if (lineLengthSq === 0) {
            return distanceBetween(point, lineStart);
        }
        
        var t = Math.max(0, Math.min(1, 
            ((point.lon - lineStart.lon) * dx + (point.lat - lineStart.lat) * dy) / lineLengthSq
        ));
        
        var closestPoint = {
            lon: lineStart.lon + t * dx,
            lat: lineStart.lat + t * dy
        };
        
        return distanceBetween(point, closestPoint);
    }

    function findInsertIndex(route, newCoord, stationCoords) {
        if (route.length < 2 || !newCoord) return -1;
        
        var bestIndex = -1;
        var bestScore = Infinity;
        
        for (var i = 1; i < route. length; i++) {
            var prevCoord = stationCoords[route[i - 1]. signature];
            var nextCoord = stationCoords[route[i].signature];
            
            if (prevCoord && nextCoord) {
                var distToPrev = distanceBetween(prevCoord, newCoord);
                var distToNext = distanceBetween(newCoord, nextCoord);
                var totalDist = distToPrev + distToNext;
                var directDist = distanceBetween(prevCoord, nextCoord);
                
                var lineDistance = pointToLineDistance(newCoord, prevCoord, nextCoord);
                
                if (lineDistance < 0.05 && totalDist < directDist * 1.3) {
                    if (totalDist < bestScore) {
                        bestScore = totalDist;
                        bestIndex = i;
                    }
                }
            }
        }
        
        return bestIndex;
    }

    function findMissingStationsFromTimetable(route, timetableAnnouncements, stationCoords) {
        var routeSigs = {};
        route.forEach(function(s) { routeSigs[s.signature] = true; });
        
        var trainSequences = {};
        timetableAnnouncements.forEach(function(ann) {
            var trainId = ann. AdvertisedTrainIdent;
            if (!trainSequences[trainId]) {
                trainSequences[trainId] = [];
            }
            var lastSig = trainSequences[trainId]. length > 0 ? 
                trainSequences[trainId][trainSequences[trainId].length - 1] : null;
            if (ann.LocationSignature !== lastSig) {
                trainSequences[trainId].push(ann. LocationSignature);
            }
        });
        
        var missingStations = [];
        
        Object.keys(trainSequences).forEach(function(trainId) {
            var sequence = trainSequences[trainId];
            
            for (var i = 0; i < sequence.length; i++) {
                var sig = sequence[i];
                
                if (routeSigs[sig]) continue;
                
                var prevOnRoute = null;
                var nextOnRoute = null;
                
                for (var j = i - 1; j >= 0; j--) {
                    if (routeSigs[sequence[j]]) {
                        prevOnRoute = sequence[j];
                        break;
                    }
                }
                
                for (var k = i + 1; k < sequence. length; k++) {
                    if (routeSigs[sequence[k]]) {
                        nextOnRoute = sequence[k];
                        break;
                    }
                }
                
                if (prevOnRoute && nextOnRoute) {
                    var prevIndex = -1;
                    var nextIndex = -1;
                    
                    for (var m = 0; m < route.length; m++) {
                        if (route[m]. signature === prevOnRoute) prevIndex = m;
                        if (route[m]. signature === nextOnRoute) nextIndex = m;
                    }
                    
                    if (prevIndex !== -1 && nextIndex !== -1 && Math.abs(nextIndex - prevIndex) <= 3) {
                        var alreadyAdded = missingStations.some(function(ms) { return ms. sig === sig; });
                        if (!alreadyAdded) {
                            missingStations.push({
                                sig: sig,
                                afterIndex: Math.min(prevIndex, nextIndex),
                                trainId: trainId
                            });
                        }
                    }
                }
            }
        });
        
        console.log('Saknade stationer från tidtabell:', missingStations);
        return missingStations;
    }

    function isTrainSameDirection(otherBearing) {
        if (myTrainBearing === null || otherBearing === null) {
            return null;
        }
        var diff = Math.abs(myTrainBearing - otherBearing);
        if (diff > 180) diff = 360 - diff;
        return diff < 90;
    }

    function isPositionRecent(timeStamp, maxMinutes) {
        if (! timeStamp) return false;
        var posTime = new Date(timeStamp);
        var now = new Date();
        var diffMinutes = (now - posTime) / 60000;
        return diffMinutes <= maxMinutes;
    }

    function scrollToCurrentTrain() {
        var $currentTrain = $('.current-train-row');
        if ($currentTrain. length > 0) {
            var rowOffset = $currentTrain.offset().top;
            var windowHeight = $(window).height();
            var scrollTo = rowOffset - (windowHeight / 3);
            
            $('html, body').animate({
                scrollTop: scrollTo
            }, 500);
        }
    }

    function loadTrainData() {
        if (! isFirstLoad) {
            scrollPos = $(window). scrollTop();
        }
        
        TrafikverketAPI.getTrainAnnouncements(trainNumber)
            .then(function(annResponse) {
                var result = annResponse. RESPONSE && annResponse.RESPONSE. RESULT && annResponse.RESPONSE.RESULT[0];
                var announcements = (result && result.TrainAnnouncement) || [];
                
                if (announcements.length === 0) {
                    showError('Tåg ' + trainNumber + ' hittades inte');
                    return;
                }

                return TrafikverketAPI. getTrainPosition(trainNumber)
                    .then(function(posResponse) {
                        var posResult = posResponse. RESPONSE && posResponse. RESPONSE.RESULT && posResponse. RESPONSE.RESULT[0];
                        var positions = (posResult && posResult.TrainPosition) || [];
                        
                        if (positions. length > 0) {
                            var pos = positions[0];
                            myTrainBearing = pos. Bearing;
                            myTrainSpeed = pos.Speed;
                            
                            if (myTrainSpeed !== null && myTrainSpeed !== undefined) {
                                $('#train-speed').text('Hastighet: ' + myTrainSpeed + ' km/h');
                            } else {
                                $('#train-speed'). text('');
                            }
                        } else {
                            myTrainBearing = null;
                            myTrainSpeed = null;
                            $('#train-speed'). text('');
                        }

                        var route = buildRoute(announcements);
                        var locationSignatures = route.map(function(s) { return s.signature; });
                        var destination = findTrainDestination(announcements);

                        $('#train-label').text('Tåg ' + trainNumber + ' → ' + destination);

                        return TrafikverketAPI. getOtherTrains(locationSignatures, trainNumber)
                            .then(function(otherResponse) {
                                var otherResult = otherResponse. RESPONSE && otherResponse.RESPONSE. RESULT && otherResponse.RESPONSE. RESULT[0];
                                var otherAnnouncements = (otherResult && otherResult.TrainAnnouncement) || [];

                                var otherTrainNumbers = [];
                                otherAnnouncements. forEach(function(a) {
                                    if (otherTrainNumbers. indexOf(a. AdvertisedTrainIdent) === -1) {
                                        otherTrainNumbers.push(a.AdvertisedTrainIdent);
                                    }
                                });

                                return TrafikverketAPI.getTrainPositions(otherTrainNumbers)
                                    .then(function(otherPosResponse) {
                                        var otherPosResult = otherPosResponse. RESPONSE && otherPosResponse.RESPONSE.RESULT && otherPosResponse. RESPONSE.RESULT[0];
                                        var otherPositions = (otherPosResult && otherPosResult.TrainPosition) || [];

                                        var positionLookup = {};
                                        otherPositions.forEach(function(p) {
                                            var trainNum = p.Train ?  p.Train. AdvertisedTrainNumber : p. AdvertisedTrainNumber;
                                            if (trainNum && ! positionLookup[trainNum] && isPositionRecent(p.TimeStamp, 5)) {
                                                positionLookup[trainNum] = p;
                                            }
                                        });

                                        var oppositeTrains = [];
                                        Object.keys(positionLookup).forEach(function(trainId) {
                                            var pos = positionLookup[trainId];
                                            var sameDir = isTrainSameDirection(pos. Bearing);
                                            if (sameDir === false) {
                                                oppositeTrains.push(trainId);
                                            }
                                        });

                                        console.log('Mötande tåg:', oppositeTrains);

                                        if (oppositeTrains.length > 0) {
                                            return $. when(
                                                TrafikverketAPI.getTrainAnnouncementsForTrains(oppositeTrains),
                                                TrafikverketAPI.getTrainTimetable(oppositeTrains),
                                                TrafikverketAPI. getAllTrainStations()
                                            ). then(function(oppResponse, timetableResponse, stationsResponse) {
                                                var oppResult = oppResponse[0]. RESPONSE && oppResponse[0].RESPONSE.RESULT && oppResponse[0]. RESPONSE.RESULT[0];
                                                var oppAnnouncements = (oppResult && oppResult. TrainAnnouncement) || [];
                                                
                                                var timetableResult = timetableResponse[0].RESPONSE && timetableResponse[0].RESPONSE.RESULT && timetableResponse[0].RESPONSE. RESULT[0];
                                                var timetableAnnouncements = (timetableResult && timetableResult.TrainAnnouncement) || [];
                                                
                                                var stationsResult = stationsResponse[0].RESPONSE && stationsResponse[0].RESPONSE. RESULT && stationsResponse[0]. RESPONSE.RESULT[0];
                                                var stations = (stationsResult && stationsResult. TrainStation) || [];
                                                
                                                console.log('Passerade announcements:', oppAnnouncements.length);
                                                console.log('Tidtabell announcements:', timetableAnnouncements.length);
                                                
                                                stations.forEach(function(st) {
                                                    if (st. Geometry && st.Geometry.WGS84) {
                                                        stationCoords[st.LocationSignature] = parseWGS84(st.Geometry.WGS84);
                                                    }
                                                });
                                                
                                                var missingStations = findMissingStationsFromTimetable(route, timetableAnnouncements, stationCoords);
                                                
                                                missingStations.sort(function(a, b) { return b.afterIndex - a.afterIndex; });
                                                
                                                missingStations.forEach(function(ms) {
                                                    var coord = stationCoords[ms.sig];
                                                    var insertIndex = ms.afterIndex + 1;
                                                    
                                                    if (coord) {
                                                        var calcIndex = findInsertIndex(route, coord, stationCoords);
                                                        if (calcIndex > 0) {
                                                            insertIndex = calcIndex;
                                                        }
                                                    }
                                                    
                                                    var exists = route.some(function(s) { return s.signature === ms.sig; });
                                                    if (!exists && insertIndex > 0 && insertIndex < route.length) {
                                                        console.log('Lägger till saknad station:', ms.sig, 'på index', insertIndex);
                                                        route.splice(insertIndex, 0, {
                                                            signature: ms.sig,
                                                            announcements: [],
                                                            isFromOtherTrain: true
                                                        });
                                                    }
                                                });
                                                
                                                var allOtherAnnouncements = otherAnnouncements.concat(oppAnnouncements);
                                                
                                                var routeSigs = route.map(function(s) { return s.signature; });
                                                var filteredAnnouncements = allOtherAnnouncements.filter(function(ann) {
                                                    return routeSigs.indexOf(ann.LocationSignature) !== -1;
                                                });
                                                
                                                return processTrains(route, filteredAnnouncements, positionLookup, destination);
                                            });
                                        } else {
                                            return processTrains(route, otherAnnouncements, positionLookup, destination);
                                        }
                                    });
                            });
                    });
            })
            .catch(function(error) {
                console.error('Fel vid laddning:', error);
                showError('Kunde inte ladda tågdata');
            });
    }

    function processTrains(route, otherAnnouncements, positionLookup, destination) {
        var trainLastStation = {};
        
        var routeSigs = {};
        route.forEach(function(s) { routeSigs[s.signature] = true; });
        
        var sortedAnnouncements = otherAnnouncements.slice().sort(function(a, b) {
            var timeA = a.TimeAtLocation ?  new Date(a.TimeAtLocation) : new Date(0);
            var timeB = b.TimeAtLocation ? new Date(b.TimeAtLocation) : new Date(0);
            return timeB - timeA;
        });

        sortedAnnouncements.forEach(function(ann) {
            var trainId = ann.AdvertisedTrainIdent;
            var sig = ann.LocationSignature;
            
            if (! routeSigs[sig]) return;
            
            var stationIndex = -1;
            for (var i = 0; i < route.length; i++) {
                if (route[i].signature === sig) {
                    stationIndex = i;
                    break;
                }
            }
            if (stationIndex === -1) return;
            
            if (!trainLastStation[trainId]) {
                var hasDeparted = ann.ActivityType === 'Avgang' && ann.TimeAtLocation;
                trainLastStation[trainId] = {
                    stationIndex: stationIndex,
                    hasDeparted: hasDeparted,
                    ann: ann
                };
            }
        });

        var trainsAtStation = {};
        var trainsBetweenStations = {};

        Object.keys(trainLastStation).forEach(function(trainId) {
            var pos = positionLookup[trainId];
            if (!pos) return;
            
            var info = trainLastStation[trainId];
            var ann = info.ann;
            var stationIndex = info.stationIndex;
            var hasDeparted = info.hasDeparted;
            
            var sameDir = isTrainSameDirection(pos. Bearing);
            if (sameDir === null) return;
            
            if (sameDir && hasDeparted && stationIndex === route.length - 1) {
                return;
            }
            if (!sameDir && hasDeparted && stationIndex === 0) {
                return;
            }
            
            var delayDiff = getDiffMinutes(ann. AdvertisedTimeAtLocation, ann. EstimatedTimeAtLocation || ann.TimeAtLocation);
            var delayInfo = formatDelay(delayDiff);
            var dest = getBestDestination(ann);
            
            var trainData = {
                trainId: trainId,
                destination: dest,
                delayInfo: delayInfo,
                sameDir: sameDir
            };
            
            var sig = route[stationIndex]. signature;
            
            if (hasDeparted) {
                if (!trainsBetweenStations[stationIndex]) {
                    trainsBetweenStations[stationIndex] = { sameDir: [], opposite: [] };
                }
                if (sameDir) {
                    trainsBetweenStations[stationIndex].sameDir.push(trainData);
                } else {
                    trainsBetweenStations[stationIndex].opposite.push(trainData);
                }
            } else {
                if (! trainsAtStation[sig]) {
                    trainsAtStation[sig] = { sameDir: [], opposite: [] };
                }
                if (sameDir) {
                    trainsAtStation[sig].sameDir. push(trainData);
                } else {
                    trainsAtStation[sig]. opposite.push(trainData);
                }
            }
        });

        var currentStationIndex = -1;
        for (var i = route.length - 1; i >= 0; i--) {
            var station = route[i];
            if (! station.isFromOtherTrain) {
                var hasArrived = station. announcements.some(function(a) { return a. TimeAtLocation; });
                if (hasArrived) {
                    currentStationIndex = i;
                    break;
                }
            }
        }

        var $tbody = $('#table-body');
        $tbody.empty();

        var reversedRoute = route. slice().reverse();

        reversedRoute.forEach(function(station, reversedIndex) {
            var index = route.length - 1 - reversedIndex;
            var sig = station.signature;
            var atStation = trainsAtStation[sig] || { sameDir: [], opposite: [] };
            var betweenStations = trainsBetweenStations[index] || { sameDir: [], opposite: [] };
            
            var hasTrains = atStation.sameDir.length > 0 || atStation.opposite.length > 0 ||
                            betweenStations.sameDir. length > 0 || betweenStations.opposite.length > 0;
            
            if (station.isFromOtherTrain && ! hasTrains) {
                return;
            }
            
            var sameDirHtml = atStation.sameDir.map(function(t) { return trainLink(t.trainId, t.destination, t.delayInfo); }).join('<br>') || '-';
            var oppositeHtml = atStation.opposite.map(function(t) { return trainLink(t.trainId, t.destination, t.delayInfo); }).join('<br>') || '-';
            
            var stationClass = station.isFromOtherTrain ? 'from-other-train' : '';
            var $row = $('<tr class="' + stationClass + '"><td>' + stationLink(sig, sig) + '</td><td>' + sameDirHtml + '</td><td>' + oppositeHtml + '</td></tr>');
            $tbody.append($row);
            
                        // Visa aktuellt tåg mellan stationer i "Tåg i riktningen" kolumnen
            if (index === currentStationIndex) {
                var currentTrainHtml = '<span style="display:inline-block; padding:6px 12px; border:2px solid #FFD700; color:#ffffff; font-weight:bold; font-style:italic;">🚂 ' + trainNumber + ' → ' + destination + '</span>';
                var $currentRow = $('<tr class="between-stations current-train-row"><td></td><td>' + currentTrainHtml + '</td><td>-</td></tr>');
                $tbody.append($currentRow);
            }
            
            if (betweenStations. sameDir.length > 0 || betweenStations.opposite.length > 0) {
                var betweenSameDirHtml = betweenStations.sameDir. map(function(t) { return trainLink(t.trainId, t.destination, t.delayInfo); }).join('<br>') || '-';
                var betweenOppositeHtml = betweenStations.opposite. map(function(t) { return trainLink(t.trainId, t.destination, t.delayInfo); }).join('<br>') || '-';
                
                var $betweenRow = $('<tr class="between-stations"><td></td><td>' + betweenSameDirHtml + '</td><td>' + betweenOppositeHtml + '</td></tr>');
                $tbody.append($betweenRow);
            }
        });

        showLoading(false);
        updateLastUpdate();
        
        // Autoscroll vid första laddning, annars behåll position
        if (isFirstLoad) {
            isFirstLoad = false;
            setTimeout(scrollToCurrentTrain, 100);
        } else {
            $(window).scrollTop(scrollPos);
        }
    }

    loadTrainData();
    refreshInterval = setInterval(loadTrainData, 30000);

    $('#refresh-btn').on('click', function() {
        loadTrainData();
    });
});