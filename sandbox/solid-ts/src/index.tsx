/* @refresh reload */
import 'virtual:bamboo.css'
import { render } from '@solidjs/web'

import App from './App'

render(() => <App />, document.getElementById('root') as HTMLElement)
