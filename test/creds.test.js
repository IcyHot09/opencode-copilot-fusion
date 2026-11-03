import test from "node:test"
import assert from "node:assert/strict"
import { copilotBaseURLFromMetadata, copilotCredentialsFromCredential } from "../dist/creds.js"

test("apiEndpoint wins; trailing path and slashes are dropped", () => {
  assert.equal(
    copilotBaseURLFromMetadata({ apiEndpoint: "https://api.business.githubcopilot.com/" }),
    "https://api.business.githubcopilot.com",
  )
  assert.equal(
    copilotBaseURLFromMetadata({ apiEndpoint: "https://api.business.githubcopilot.com/some/path" }),
    "https://api.business.githubcopilot.com",
  )
})

test("enterpriseUrl produces GHES host; scheme-less input works", () => {
  assert.equal(
    copilotBaseURLFromMetadata({ enterpriseUrl: "https://ghe.example.com/org" }),
    "https://copilot-api.ghe.example.com",
  )
  assert.equal(
    copilotBaseURLFromMetadata({ enterpriseUrl: "ghe.example.com" }),
    "https://copilot-api.ghe.example.com",
  )
})

test("hostile metadata never points the bearer token at an attacker host", () => {
  assert.equal(
    copilotBaseURLFromMetadata({ apiEndpoint: "https://api.githubcopilot.com@evil.com/" }),
    "https://api.githubcopilot.com",
  )
  assert.equal(
    copilotBaseURLFromMetadata({ apiEndpoint: "http://api.githubcopilot.com/" }),
    "https://api.githubcopilot.com",
  )
  assert.equal(
    copilotBaseURLFromMetadata({ enterpriseUrl: "github.example.com@evil.com" }),
    "https://api.githubcopilot.com",
  )
  assert.equal(
    copilotBaseURLFromMetadata({ enterpriseUrl: "https://evil host.com/" }),
    "https://api.githubcopilot.com",
  )
})

test("defaults to api.githubcopilot.com", () => {
  assert.equal(copilotBaseURLFromMetadata(undefined), "https://api.githubcopilot.com")
  assert.equal(copilotBaseURLFromMetadata({}), "https://api.githubcopilot.com")
  assert.equal(copilotBaseURLFromMetadata("garbage"), "https://api.githubcopilot.com")
})

test("oauth credential yields access token + resolved baseURL", () => {
  const creds = copilotCredentialsFromCredential({
    type: "oauth",
    refresh: "gho_abc",
    access: "gho_abc",
    metadata: { apiEndpoint: "https://api.business.githubcopilot.com" },
  })
  assert.deepEqual(creds, { token: "gho_abc", baseURL: "https://api.business.githubcopilot.com" })
})

test("non-oauth and missing tokens are rejected", () => {
  assert.equal(copilotCredentialsFromCredential(undefined), undefined)
  assert.equal(copilotCredentialsFromCredential({ type: "api", apiKey: "x" }), undefined)
  assert.equal(copilotCredentialsFromCredential({ type: "oauth" }), undefined)
})
