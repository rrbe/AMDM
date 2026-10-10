import type { MongoClient } from 'mongodb'
import type { AuthorizationResult, ConnectionAuthorization } from '../../shared/types'

/** Read only the current connection's authorization, without credentials or BSON metadata. */
export async function readAuthorization(client: MongoClient): Promise<AuthorizationResult> {
  try {
    const { authInfo } = (await client.db('admin').command(
      { connectionStatus: 1, showPrivileges: true },
      { timeoutMS: 5_000 }
    )) as {
      authInfo: {
        authenticatedUsers: ConnectionAuthorization['users']
        authenticatedUserRoles: ConnectionAuthorization['roles']
        authenticatedUserPrivileges: ConnectionAuthorization['privileges']
      }
    }
    return {
      authorization: {
        users: authInfo.authenticatedUsers.map(({ user, db }) => ({ user, db })),
        roles: authInfo.authenticatedUserRoles.map(({ role, db }) => ({ role, db })),
        privileges: authInfo.authenticatedUserPrivileges.map(({ resource, actions }) => ({
          resource: { ...resource },
          actions: [...actions]
        }))
      }
    }
  } catch (error) {
    return { authorizationError: error instanceof Error ? error.message : String(error) }
  }
}
