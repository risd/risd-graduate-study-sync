const debug = require('debug')('involved-events')

const request = require('request')
const moment = require('moment')
const miss = require('mississippi')

module.exports = InvolvedEvents;

/**
 * Events are powered by the involved.risd.edu API.
 */
function InvolvedEvents (envConf) {
  if (!(this instanceof InvolvedEvents)) return new InvolvedEvents(envConf)
  const self = this
  self.apiKey = envConf.involved.apiKey
}

InvolvedEvents.prototype.webhookContentType = ''
InvolvedEvents.prototype.keyFromWebhook = function (row) {
  // return row.localist_uid;
};
InvolvedEvents.prototype.keyFromSource = function (row) {
  return row.id;
};

InvolvedEvents.prototype.listSource = function () {
  const self = this
  const endsAfter = moment().format()

  let totalItems = -1
  let itemCount = 0

  const eventStream = miss.through.obj()

  process.nextTick(() => requestEvents())

  return eventStream

  // sets `totalItems`` based on query results
  // pushes into `items` based on query results
  function requestEvents ({ skip = 0, take = 100 } = {}) {
    const queryString = makeQueryString({ skip, take, endsAfter })
    const url = `https://engage-api.campuslabs.com/api/v3.0/events/event${queryString}`
    let data = ''

    miss.pipe(
      request({
        method: 'GET',
        url,
        headers: {
          'X-Engage-Api-Key': self.apiKey,
        },
      }),
      miss.through.obj(
        function concat (row, enc, next) {
          data += row.toString()
          next()
        },
        function end () {
          try {
            const result = JSON.parse(data)
            if (totalItems === -1) totalItems = result.totalItems
            itemCount += result.items.length
            // filter items based on what is going to be on the site
            // before pushing into the stream
            result.items.forEach((item) => {
              eventStream.push(item)
            })
          }
          catch (error) {
            this.emit(error)
          }
        }
      ),
      function onPipelineComplete (error) {
        if (error) eventStream.emit(error)

        if (totalItems > itemCount) requestEvents({ skip: itemCount, take: 100 })
        else eventStream.push(null)
      }
    )
  }

  function makeQueryString (options) {
    const qs = []
    if (!options) return ''

    const validKeys = ['endsAfter', 'skip', 'take']

    validKeys.forEach(function (validKey) {
      if (options[validKey]) qs.push(`${validKey}=${encodeURIComponent(options[validKey])}`)
    })

    return `${qs.length > 0 ? '?' : ''}${qs.join('&')}`
  }
}
