<script lang="ts">
  import { onMount } from "svelte"
  import {
    getSharedSession,
    loginUrl,
    signOutShared,
    type SharedUser,
  } from "@v5x/auth/browser"
  import { Button } from "~/lib/components/ui/button"

  let user = $state<SharedUser | null>(null)
  let ready = $state(false)
  const href = loginUrl(window.location.href)

  onMount(() => {
    void getSharedSession()
      .then((session) => {
        user = session
      })
      .catch(() => {
        user = null
      })
      .finally(() => {
        ready = true
      })
  })

  async function signOut() {
    await signOutShared()
    location.reload()
  }
</script>

{#if ready && user}
  {@const label = user.name || user.email || "Account"}
  <Button
    variant="ghost"
    size="sm"
    title="Sign out"
    aria-label={`Sign out ${label}`}
    onclick={signOut}
  >
    {label}
  </Button>
{:else}
  <Button variant="ghost" size="sm" {href} disabled={!ready}>Sign in</Button>
{/if}
