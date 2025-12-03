var TrafikverketAPI = {
    apiKey: '4759059607504e98ba567480d71df54e',
    apiUrl: 'https://api.trafikinfo.trafikverket.se/v2/data.json',

    escapeXml: function(str) {
        if (!str) return '';
        return String(str). replace(/[<>&'"]/g, function(c) {
            switch (c) {
                case '<': return '&lt;';
                case '>': return '&gt;';
                case '&': return '&amp;';
                case "'": return '&apos;';
                case '"': return '&quot;';
            }
        });
    },

    request: function(query) {
        var xmlRequest = '<REQUEST>' +
            '<LOGIN authenticationkey="' + this.apiKey + '" />' +
            query +
            '</REQUEST>';
        console.log('API Request:', xmlRequest);
        return $. ajax({
            url: this.apiUrl,
            method: 'POST',
            contentType: 'text/xml',
            data: xmlRequest,
            dataType: 'json'
        });
    },

    getTrainAnnouncements: function(trainNumber) {
        var today = new Date().toISOString().split('T')[0];
        var query = '<QUERY objecttype="TrainAnnouncement" schemaversion="1.6" orderby="AdvertisedTimeAtLocation">' +
            '<FILTER>' +
                '<AND>' +
                    '<EQ name="AdvertisedTrainIdent" value="' + this.escapeXml(trainNumber) + '" />' +
                    '<GTE name="AdvertisedTimeAtLocation" value="' + today + 'T00:00:00" />' +
                    '<LTE name="AdvertisedTimeAtLocation" value="' + today + 'T23:59:59" />' +
                '</AND>' +
            '</FILTER>' +
            '<INCLUDE>ActivityType</INCLUDE>' +
            '<INCLUDE>AdvertisedTimeAtLocation</INCLUDE>' +
            '<INCLUDE>AdvertisedTrainIdent</INCLUDE>' +
            '<INCLUDE>EstimatedTimeAtLocation</INCLUDE>' +
            '<INCLUDE>LocationSignature</INCLUDE>' +
            '<INCLUDE>TimeAtLocation</INCLUDE>' +
            '<INCLUDE>ToLocation</INCLUDE>' +
            '<INCLUDE>FromLocation</INCLUDE>' +
            '<INCLUDE>TrackAtLocation</INCLUDE>' +
            '<INCLUDE>Canceled</INCLUDE>' +
            '</QUERY>';
        return this.request(query);
    },

    getTrainPosition: function(trainNumber) {
        var query = '<QUERY objecttype="TrainPosition" namespace="järnväg.trafikinfo" schemaversion="1.0">' +
            '<FILTER>' +
                '<EQ name="Train.AdvertisedTrainNumber" value="' + this.escapeXml(trainNumber) + '" />' +
            '</FILTER>' +
            '<INCLUDE>Train.AdvertisedTrainNumber</INCLUDE>' +
            '<INCLUDE>Position.WGS84</INCLUDE>' +
            '<INCLUDE>Speed</INCLUDE>' +
            '<INCLUDE>Bearing</INCLUDE>' +
            '<INCLUDE>TimeStamp</INCLUDE>' +
            '</QUERY>';
        return this. request(query);
    },

    getTrainPositions: function(trainNumbers) {
        if (!trainNumbers || trainNumbers.length === 0) {
            return $. Deferred().resolve({ RESPONSE: { RESULT: [{ TrainPosition: [] }] } });
        }
        var self = this;
        var limitedTrains = trainNumbers.slice(0, 30);
        var trainFilters = limitedTrains.map(function(num) {
            return '<EQ name="Train.AdvertisedTrainNumber" value="' + self.escapeXml(num) + '" />';
        }). join('');
        var query = '<QUERY objecttype="TrainPosition" namespace="järnväg.trafikinfo" schemaversion="1.0">' +
            '<FILTER>' +
                '<OR>' + trainFilters + '</OR>' +
            '</FILTER>' +
            '<INCLUDE>Train.AdvertisedTrainNumber</INCLUDE>' +
            '<INCLUDE>Position.WGS84</INCLUDE>' +
            '<INCLUDE>Speed</INCLUDE>' +
            '<INCLUDE>Bearing</INCLUDE>' +
            '<INCLUDE>TimeStamp</INCLUDE>' +
            '</QUERY>';
        return this. request(query);
    },

    getOtherTrains: function(locationSignatures, excludeTrainIdent) {
        if (!locationSignatures || locationSignatures.length === 0) {
            return $. Deferred().resolve({ RESPONSE: { RESULT: [{ TrainAnnouncement: [] }] } });
        }
        var self = this;
        var now = new Date();
        var thirtyMinAgo = new Date(now.getTime() - 30 * 60 * 1000). toISOString();
        var oneHourLater = new Date(now.getTime() + 60 * 60 * 1000). toISOString();
        var locationFilters = locationSignatures.map(function(sig) {
            return '<EQ name="LocationSignature" value="' + self.escapeXml(sig) + '" />';
        }).join('');
        var query = '<QUERY objecttype="TrainAnnouncement" schemaversion="1.6" orderby="AdvertisedTimeAtLocation">' +
            '<FILTER>' +
                '<AND>' +
                    '<OR>' + locationFilters + '</OR>' +
                    '<GTE name="AdvertisedTimeAtLocation" value="' + thirtyMinAgo + '" />' +
                    '<LTE name="AdvertisedTimeAtLocation" value="' + oneHourLater + '" />' +
                    '<NE name="AdvertisedTrainIdent" value="' + this.escapeXml(excludeTrainIdent) + '" />' +
                    '<EXISTS name="TimeAtLocation" value="true" />' +
                '</AND>' +
            '</FILTER>' +
            '<INCLUDE>ActivityType</INCLUDE>' +
            '<INCLUDE>AdvertisedTimeAtLocation</INCLUDE>' +
            '<INCLUDE>AdvertisedTrainIdent</INCLUDE>' +
            '<INCLUDE>EstimatedTimeAtLocation</INCLUDE>' +
            '<INCLUDE>LocationSignature</INCLUDE>' +
            '<INCLUDE>TimeAtLocation</INCLUDE>' +
            '<INCLUDE>ToLocation</INCLUDE>' +
            '<INCLUDE>FromLocation</INCLUDE>' +
            '<INCLUDE>Canceled</INCLUDE>' +
            '</QUERY>';
        return this.request(query);
    },

    // Hämta ALLA announcements för specifika tåg (för att få oannonserade driftplatser)
    getTrainAnnouncementsForTrains: function(trainNumbers) {
        if (!trainNumbers || trainNumbers.length === 0) {
            return $.Deferred().resolve({ RESPONSE: { RESULT: [{ TrainAnnouncement: [] }] } });
        }
        var self = this;
        var today = new Date().toISOString().split('T')[0];
        var limitedTrains = trainNumbers. slice(0, 20);
        var trainFilters = limitedTrains.map(function(num) {
            return '<EQ name="AdvertisedTrainIdent" value="' + self.escapeXml(num) + '" />';
        }).join('');
        var query = '<QUERY objecttype="TrainAnnouncement" schemaversion="1.6" orderby="AdvertisedTimeAtLocation">' +
            '<FILTER>' +
                '<AND>' +
                    '<OR>' + trainFilters + '</OR>' +
                    '<GTE name="AdvertisedTimeAtLocation" value="' + today + 'T00:00:00" />' +
                    '<LTE name="AdvertisedTimeAtLocation" value="' + today + 'T23:59:59" />' +
                    '<EXISTS name="TimeAtLocation" value="true" />' +
                '</AND>' +
            '</FILTER>' +
            '<INCLUDE>ActivityType</INCLUDE>' +
            '<INCLUDE>AdvertisedTimeAtLocation</INCLUDE>' +
            '<INCLUDE>AdvertisedTrainIdent</INCLUDE>' +
            '<INCLUDE>EstimatedTimeAtLocation</INCLUDE>' +
            '<INCLUDE>LocationSignature</INCLUDE>' +
            '<INCLUDE>TimeAtLocation</INCLUDE>' +
            '<INCLUDE>ToLocation</INCLUDE>' +
            '<INCLUDE>FromLocation</INCLUDE>' +
            '<INCLUDE>Canceled</INCLUDE>' +
            '</QUERY>';
        return this.request(query);
    },
     // Hämta HELA tidtabellen för specifika tåg (alla stopp, även utan TimeAtLocation) 
    getTrainTimetable: function(trainNumbers) {
        if (!trainNumbers || trainNumbers.length === 0) {
            return $.Deferred().resolve({ RESPONSE: { RESULT: [{ TrainAnnouncement: [] }] } });
        }
        var self = this;
        var today = new Date().toISOString().split('T')[0];
        var limitedTrains = trainNumbers.slice(0, 20);
        var trainFilters = limitedTrains.map(function(num) {
            return '<EQ name="AdvertisedTrainIdent" value="' + self.escapeXml(num) + '" />';
        }).join('');
        var query = '<QUERY objecttype="TrainAnnouncement" schemaversion="1.6" orderby="AdvertisedTimeAtLocation">' +
            '<FILTER>' +
                '<AND>' +
                    '<OR>' + trainFilters + '</OR>' +
                    '<GTE name="AdvertisedTimeAtLocation" value="' + today + 'T00:00:00" />' +
                    '<LTE name="AdvertisedTimeAtLocation" value="' + today + 'T23:59:59" />' +
                '</AND>' +
            '</FILTER>' +
            '<INCLUDE>ActivityType</INCLUDE>' +
            '<INCLUDE>AdvertisedTimeAtLocation</INCLUDE>' +
            '<INCLUDE>AdvertisedTrainIdent</INCLUDE>' +
            '<INCLUDE>LocationSignature</INCLUDE>' +
            '<INCLUDE>ToLocation</INCLUDE>' +
            '</QUERY>';
        return this.request(query);
    },
    getAllTrainStations: function() {
        var query = '<QUERY objecttype="TrainStation" namespace="rail.infrastructure" schemaversion="1.5">' +
            '<FILTER>' +
                '<EQ name="Prognosticated" value="true" />' +
            '</FILTER>' +
            '<INCLUDE>LocationSignature</INCLUDE>' +
            '<INCLUDE>AdvertisedLocationName</INCLUDE>' +
            '<INCLUDE>Geometry.WGS84</INCLUDE>' +
            '</QUERY>';
        return this.request(query);
    }
};