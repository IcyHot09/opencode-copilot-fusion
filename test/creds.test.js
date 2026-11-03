import test from "node:test"
import assert from "node:assert/strict"
import { copilotBaseURLFromMetadata, copilotCredentialsFromCredential } from "../dist/creds.js"

test("apiEndpoint wins and trailing slashes are stripped", () => {
  assert.equal(
    copilotBaseURLFromMetadata({ apiEndpoint: "https://api.business.githubcopilot.com/" }),
    "https://api.business.githubcopilot.com",
  )
})

test("enterpriseUrl produces GHES host", () => {
  assert.equal(
    copilotBaseURLFromMetadata({ enterpriseUrl: "https://github.example.com/" }),
    "https://copilot-api.github.example.com",
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
