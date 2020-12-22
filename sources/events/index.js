var debug = require('debug')('events');

var request = require('request');
var moment = require('moment');
var timezone = require('moment-timezone');
var miss = require('mississippi');

module.exports = Events;

/**
 * Events are powered by the Localist API.
 */
function Events () {
    if (!(this instanceof Events)) return new Events();
    var self = this;

    this.url = {
        base: 'https://events.risd.edu/api/2.1/'
    };
    this.url._events = this.url.base + 'events';
    this.url.events = function (opts) {
        var u = [self.url._events];
        if ('page' in opts) {
            u = u.concat([
                '/?',
                'page=',
                opts.page.current,
                '&',
                'pp=100'
            ]);
            if ('days' in opts) {
                u = u.concat([
                    '&',
                    'days=',
                    opts.days
                ]);
            }
        }
        else if ('days' in opts) {
            u = u.concat([
                '/?',
                'days=',
                opts.days,
                '&',
                'pp=100'
            ]);
        }

        u = u.concat( [ '&all_custom_fields=true' ] )

        return u.join('');
    };
}

Events.prototype.webhookContentType = 'localistevents';
Events.prototype.keyFromWebhook = function (row) {
    return row.localist_uid;
};
Events.prototype.keyFromSource = function (row) {
    return row.event.id;
};

Events.prototype.listSource = function () {
    var self = this;
    debug('listSource::start');

    // stream of Event objects from localist
    var eventStream = miss.through.obj();
    // stream that controls paginated requests
    // to localist
    var pagingStream = miss.through.obj();

    // Push paging query options into
    // the paging stream to have the
    // pushed into the eventStream
    // This is the business.
    pagingStream.pipe(RecursivePage());

    // End the business.
    pagingStream.on('end', function () {
        // End the return stream that is
        // writing events.
        debug('listSource::end');
        eventStream.push(null);
    });

    var frmtString = 'YYYY-MM-DD';

    var initialPageQueryOpts = {
        days: 365
    };

    pagingStream.push(initialPageQueryOpts);


    return eventStream;

    function RecursivePage () {
        return miss.through.obj(pg);

        function pg (pageQueryOpts, enc, next) {
            var req = getEvents(pageQueryOpts);

            req.on('data', function (data) {
                if ('events' in data) {
                    data.events
                        .filter( function ( datum ) {
                            var isFlagged = false;
                            try {
                                isFlagged = datum.event.custom_fields
                                    .add_to_calendar_at_graduatestudyrisdedu
                                    .toLowerCase()
                                    .indexOf('yes') > -1;
                            } catch ( error ) {
                                isFlagged = false;
                            }
                            return isFlagged;
                        } )
                        .forEach(function (e) {
                            eventStream.push(e)
                        });
                }
                if ('page' in data) {
                    pageQueryOpts.page = data.page;
                }
            });

            req.on('end', function () {
                if (pageQueryOpts.page.current <
                    pageQueryOpts.page.total) {

                    pageQueryOpts.page.current += 1;
                    pagingStream.push(pageQueryOpts);

                } else {
                    pagingStream.push(null);
                }
                next();
            });
        }

        function getEvents (opts) {
            var t = miss.through.obj();
            var u = self.url.events(opts);
            debug('Localist events fetch: ' + u);

            var data = [];
            request.get(u)
                .pipe(miss.through.obj(function (row, enc, next) {
                    data.push(row.toString());
                    next();
                }, function end () {
                    try {
                        var events = JSON.parse(data.join(''));
                        t.push(events);
                    } catch (err) {
                        console.error(err);
                        var e = [
                            'Error getting localist events. ',
                            'Need to have all of the events, ',
                            'before Firebase differences can ',
                            'be accounted for.\n',
                            'Try again shortly.'
                        ];
                        throw new Error(e.join(''));
                    }
                    t.push(null);
                }));

            return t;
        }
    }
};


Events.prototype.sourceStreamToFirebaseSource = function () {
    var self = this;

    return miss.through.obj(toFirebase);

    function toFirebase (row, enc, next) {
        var stream = this;

        // check to see if this key
        // has already been added
        var key = self.keyFromSource(row);
        self._firebase
            .source
            .child(key)
            .once('value', onCheckComplete, onCheckError);

        function onCheckError (error) {
            console.error('sourceStreamToFirebaseSource:toFirebase:error');
            console.error(error);
            onAddComplete();
        }

        function onCheckComplete (snapshot) {
            var value = snapshot.val();

            // value exists add instance times
            if (value) {
                var instances = value.event
                                     .event_instances
                                     .concat(row.event
                                                .event_instances);

                self._firebase
                    .source
                    .child(key)
                    .child('event')
                    .child('event_instances')
                    .set(instances, onAddComplete);

            }
            // value does not exist, add it
            else {
                self._firebase
                    .source
                    .child(key)
                    .set(row, onAddComplete);
            }
        }

        function onAddComplete () {
            next();
        }

    }
};


Events.prototype.updateWebhookValueWithSourceValue = function (wh, src) {
    src = src.event;

    wh.name = [
        readable_date(src.first_date),
        src.title,
        src.id
    ].join(' ');
    wh.localist_title = src.title.trim();
    wh.localist_uid = src.id;
    wh.localist_venue_uid = src.venue_id || '';
    wh.localist_featured = src.featured || false;
    wh.localist_date_range_start = src.first_date;
    wh.localist_date_range_end = src.last_date;

    wh.localist_instances = src.event_instances
        .map(function (d) {
            if ((d.event_instance.all_day) ||
                (!('end' in d.event_instance))){
                d.event_instance.end = '';
            }
            return {
                start:   d.event_instance.start,
                end:     d.event_instance.end,
                all_day: d.event_instance.all_day,
                id:      d.event_instance.id
            };
        });
    wh.localist_url = src.localist_url || '';
    wh.localist_event_url = src.url || '';
    wh.localist_photo_url = src.photo_url || '';
    wh.localist_venue_url = src.venue_url || '';
    wh.localist_ticket_url = src.ticket_url || '';
    
    wh.localist_room_number = src.room_number || '';
    wh.localist_location_name = src.location_name || '';
    if (src.geo) {
        wh.localist_address = {
            city: src.geo.city || '',
            country: src.geo.country || '',
            state: src.geo.state || '',
            street1: src.geo.street || '',
            zip: src.geo.zip || '',
        };
        wh.localist_location_coordinates = {
            latitude: src.geo.latitude || '',
            longitude: src.geo.longitude || ''
        };
    }
    
    wh.localist_description_text = src.description_text || '';
    wh.localist_description_html = src.description || '';
    wh.localist_ticket_cost = src.ticket_cost || '';
    wh.localist_filters__department = (function (filters) {
            if ('departments' in filters) {
                return filters.departments.map(function (d) {
                    return { department: d.name };
                });
            } else {
                return [];
            }
            
        })(src.filters || {});
    wh.localist_filters__event_types = (function (filters) {
            if ('event_types' in filters) {
                return filters.event_types.map(function (d) {
                    return { name: d.name };
                });
            } else {
                return [];
            }
        })(src.filters || {});
    wh.isDraft = false;

    return (eventDateSort(wh));

    function eventDateSort (d) {
        var fields = [
            'localist_date_range_start',
            'localist_date_range_end'
        ];

        fields.forEach(function (field) {
            if (field in d && (d[field])) {
                if (d[field].length > 0) {
                    var dt = new Date(d[field]);
                    d['_sort_' + field] = dt.getTime();
                }
            }
        });

        return d;
    }

    function readable_date (date) {
        return moment(date).format('YYYY-MM-DD')
    }
};

Events.prototype.relationshipsToResolve = function () {
    return []
};


Events.prototype.dataForRelationshipsToResolve = function (currentWHData) {
    return this.relationshipsToResolve();
};

/**
 * updateWebhookValueNotInSource implementation
 * for events. If they are in WebHook & not in
 * source & older than 60 days, lets remove them.
 *
 * @return {stream} through.obj transform stream
 */
Events.prototype.updateWebhookValueNotInSource = function () {
    var self = this;
    var now = moment();
    return miss.through.obj(updateNotInSource);

    function updateNotInSource (row, enc, next) {
        var remove = false;

        if (row.inSource === false) {
            // not in source
            var endOfLastDayStr = addEndOfDay(
                row.webhook.localist_date_range_end);

            // reasons for removal
            var noEndDate = endOfLastDayStr === false; // no last date
            var isWellInThePast = moment(endOfLastDayStr).isBefore(now.subtract(60, 'days')); // removed from the API, being in the past

            if ( noEndDate || isWellInThePast ) {
                // last day of the event occured before 60 days ago
                remove = true;
            }
        }

        if (remove) {
            debug('removing:' + row.webhook.name);
            var stream = this;
            self._firebase
                .webhook
                .child(row.whKey)
                .remove(function onComplete () {
                    next(null, row);
                });
        } else {
            next();
        }

        
    }
    
    function addEndOfDay (dateString) {
        var justBeforeMidnight = 'T23:59:59-04:00';
        try {
            return [dateString.split('T')[0], justBeforeMidnight].join('');    
        } catch (error) {
            return false;
        }   
    }
};
