var debug = require( 'debug' )( 'map-localist-events-prototype' )
var moment = require('moment-timezone')
var assert = require( 'assert' )

module.exports = MapLocalistEvents;

function MapLocalistEvents () {
  if ( ! ( this instanceof MapLocalistEvents ) ) return new MapLocalistEvents()
}

MapLocalistEvents.prototype.webhookContentType = 'localistevents'
MapLocalistEvents.prototype.mapFn = mapLocalistEventsFn;
MapLocalistEvents.prototype.mapRelatedFn = mapRelatedEventsFn;

function mapLocalistEventsFn ( event ) { return event }

function mapRelatedEventsFn ( widget, widgetKey, widgetKeyInGrid, events ) {
  assert( typeof events === 'object', 'Related data needs to be passed in to update relationship widgets.' )

  if ( typeof widget === 'undefined' ) return widget;

  var emptyRelationshipIfInThePast = updateRelationshipIf( isPastLocalistEvent, emptyRelationship )
  var emptyGridRowIfInThePast = emptyGridRowIf( emptyRelationshipIfInThePast )
  
  if ( isRelationshipInRepeatable( widget, widgetKey, widgetKeyInGrid ) ) {
    // relationship widget lives in a repeatable
    widget = widget.map( emptyGridRowIfInThePast ).filter( isPopulatedRow )
  }
  else if ( isMultipleRelationship( widget, widgetKey, widgetKeyInGrid ) ) {
    // widget is a multiple relationship
    widget = widget.map( emptyRelationshipIfInThePast ).filter( isPopulatedRelationship )
  }
  else if ( isSingleRelationship( widget ) ) {
    // widget is a single relationship
    widget = [ widget ].map( emptyRelationshipIfInThePast )[ 0 ]
  }

  return widget;

  /* localist event helpers */
  
  function isPastLocalistEvent ( localist_event ) {
    return ! isFutureTime( moment( endTimeForLocalistEvent( localist_event ) ) )
  }

  function isFutureTime ( time ) {
    var now = moment().tz( 'America/New_York' )
    return now.isBefore( time )
  }

  function endTimeForLocalistEvent ( localist_event ) {
    var endTime = endOfDay( localist_event.localist_date_range_end )
    if ( Array.isArray( localist_event.localist_instances ) &&
         localist_event.localist_instances.length > 0 ) {
      var possibleEndTime = localist_event.localist_instances[ localist_event.localist_instances.length - 1 ].end
      // check to see if there was an end time, and use that
      if ( possibleEndTime ) endTime = possibleEndTime
    }
    return endTime;
  }

  function endOfDay ( dateString ) {
    var justBeforeMidnight = 'T23:59:59-04:00'
    try {
      return [ dateString.split( 'T' )[ 0 ], justBeforeMidnight ].join( '' )
    } catch ( error ) {
      return false;
    }
  }

  function emptyRelationship ( relationship ) {
    return ''
  }

  /* common helpers : could be factored into `webhook-cms-pull/map.js` */

  function updateRelationshipIf ( predicateFn, updateFn ) {
    return function emptyRelationshipIfPredicate ( relationship ) {
      if ( ! isPopulatedRelationship( relationship ) ) return relationship;
      var relatedToKey = relationshipKey( relationship )
      var relatedItem = events[ relatedToKey ]
      if ( predicateFn( relatedItem ) ) relationship = updateFn( relationship )
      return relationship;   
    }
  }

  function emptyGridRowIf ( updateRelationshipIfPredicate ) {
    return function emptyRowIfWidgetKeyArchived ( row ) {
      if ( ! isPopulatedRow( row ) ) return undefined;

      var rowWidget = row[ widgetKey ]

      if ( ! rowWidget ) return row;

      if ( isMultipleRelationship( rowWidget ) ) {
        // no such cases, not sure how it should be handled yet
        row[ widgetKey ] = rowWidget.map( updateRelationshipIfPredicate ).filter( isPopulatedRelationship )
        if ( ! isPopulatedMultipleRelationship( row[ widgetKey ] ) ) row = saveRowIfOthersRelated( row )
      }
      else if ( isSingleRelationship( rowWidget ) ) {
        row[ widgetKey ] = [ rowWidget ].map( updateRelationshipIfPredicate )[ 0 ]
        if ( ! isPopulatedRelationship( row[ widgetKey ] ) ) row = saveRowIfOthersRelated( row )
      }

      return row;
    }
  }
}

/* common helpers : could be factored into `webhook-cms-pull/map.js` */

function isRelationshipInRepeatable ( widget, widgetKey, widgetKeyInGrid ) {
  return Array.isArray( widget ) && typeof widgetKey === 'string' && widgetKeyInGrid === true;
}

function isMultipleRelationship ( widget, widgetKey, widgetKeyInGrid ) {
  return Array.isArray( widget ) && typeof widgetKey === 'string' && widgetKeyInGrid === false;
}

function isSingleRelationship ( widget ) {
  return typeof widget === 'string'
}

function relationshipKey ( relationship ) {
  return relationship.split( ' ' )[ 1 ]
}

function isPopulatedRow ( row ) {
  return typeof row === 'object';
}

function isPopulatedRelationship ( relationship ) {
  return typeof relationship === 'string' && relationship.split( ' ' ).length === 2 && relationshipKey( relationship ).startsWith( '-' );
}

function isPopulatedMultipleRelationship ( relationship ) {
  return Array.isArray( relationship ) &&
    relationship.length > 0 &&
    ( relationship.filter( isPopulatedRelationship ).length === relationship.length );
}
