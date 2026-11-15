import { test } from 'node:test'
import assert from 'node:assert/strict'
import { attachSparePlayers, findViewingTeam } from '../src/utils/teamHelpers.js'

const player = { id: 'player', full_name: 'Pat' }
const teams = [
  { id: 1, team_members: [{ id: 'membership', profiles: player, position: 'goalie' }] },
  { id: 2, team_members: [] },
  { id: 3, team_members: [] },
]

test('spares appear once below their selected team and never duplicate main roster players', () => {
  const result = attachSparePlayers(teams, [
    { team_id: 1, profiles: player },
    { team_id: 2, profiles: player },
    { team_id: 2, profiles: player },
    { team_id: 3, profiles: null },
  ])
  assert.equal(result[0].spares.length, 0)
  assert.equal(result[1].team_members.length, 0)
  assert.equal(result[1].spares.length, 1)
  assert.equal(result[1].spares[0].position, 'goalie')
  assert.equal(result[2].spares.length, 0)
  assert.equal(teams[1].spares, undefined)
})

test('viewing a spare team leaves main membership intact and accepts string IDs', () => {
  const result = attachSparePlayers(teams, [{ team_id: 2, profiles: player }])
  assert.equal(findViewingTeam(result, { ...player, active_team_id: '2' }).id, 2)
  assert.equal(result[0].team_members[0].profiles.id, player.id)
  assert.equal(findViewingTeam(result, player).id, 1)
})

test('unrelated or removed viewing teams fall back to the main team', () => {
  const result = attachSparePlayers(teams, [])
  assert.equal(findViewingTeam(result, { ...player, active_team_id: '3' }).id, 1)
  assert.equal(findViewingTeam(result, { ...player, active_team_id: '2' }).id, 1)
  assert.equal(findViewingTeam(result, { id: 'unknown', active_team_id: '2' }), null)
})

test('players with only spare teams can view a spare schedule', () => {
  const spare = { id: 'spare' }
  const result = attachSparePlayers(teams, [{ team_id: 2, profiles: spare }])
  assert.equal(findViewingTeam(result, spare).id, 2)
  assert.equal(result[1].spares[0].profiles.id, spare.id)
  assert.equal(findViewingTeam([], spare), null)
})
