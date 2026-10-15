import { connectionStore } from '../store/connectionStore'
import { SessionManager } from './sessionManager'

export const sessionManager = new SessionManager(connectionStore)
