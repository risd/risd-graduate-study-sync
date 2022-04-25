const InvolvedEvents = require('../sources/involved-events/index.js')
const miss = require('mississippi')
const test = require('tape')
var Env = require('../env.js')();
var envConf = Env.asObject();

const involvedEvents = InvolvedEvents(envConf)

test('list-involved-events', function (t) {
  t.plan(1)
  
  const source = involvedEvents.listSource()
  const counter = Counter()

  miss.pipe(source, counter.stream, function (error) {
    if (error) t.fail(error, 'failed to list source')
    else t.ok(counter.value() > 0, 'succeeded to  list source')
  })
})

function Counter () {
  let value = 0
  return {
    stream: miss.through.obj((row, enc, next) => {
      if (row.name === 'Exhibition | Furniture Design Graduate Biennial ') console.log(row)
      value += 1
      next()
    }),
    value: () => value,
  }
}
