import { expect, test } from '@playwright/test'

test('loads, edits, saves, and opens local management', async ({ page }, testInfo) => {
  await page.goto('/workspace')
  await expect(page).toHaveTitle('DSH 文件工作区')
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN')
  await expect(page.getByRole('option', { name: 'E2E project' })).toBeAttached()
  await page.getByRole('button', { name: /src/ }).click()
  await page.getByRole('button', { name: /sample\.ts/ }).click()
  const editor = page.locator('.cm-content')
  await expect(editor).toContainText('answer =')
  const answer = testInfo.project.name.includes('mobile') ? 44 : 43
  await editor.fill(`export const answer = ${answer}`)
  await page.getByRole('button', { name: '保存' }).click()
  await expect(page.locator('.daw-status')).toContainText('已保存')

  await page.getByTitle('设置', { exact: true }).click()
  await expect(page.getByRole('dialog', { name: '工作区设置' })).toBeVisible()
  await expect(page.getByText('E2E project').last()).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('workspace.png'), fullPage: true })
  await page.getByTitle('关闭').click()

  const search = page.getByPlaceholder('搜索文件名…')
  await search.fill('sample')
  await expect(page.locator('.daw-search-row')).toHaveCount(1)
  await page.locator('.daw-search-row').first().click()
  await expect(page.locator('.daw-filepath')).toHaveText('src/sample.ts')
})

test('switches to English and persists the preference', async ({ page }) => {
  await page.goto('/workspace')
  await page.getByTitle('切换到 English').first().click()
  await expect(page).toHaveTitle('DSH Workspace')
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await expect(page.getByRole('button', { name: 'Save' })).toBeVisible()

  await page.reload()
  await expect(page).toHaveTitle('DSH Workspace')
  await expect(page.getByTitle('Switch to 中文').first()).toBeVisible()
  await page.getByTitle('Settings', { exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Workspace settings' })).toBeVisible()
})

test('edits and persists the remote listener target', async ({ page }, testInfo) => {
  await page.goto('/workspace')
  await page.getByTitle('设置', { exact: true }).click()
  await page.getByRole('button', { name: '远程访问' }).click()
  const host = page.getByLabel('绑定 IP')
  const port = page.getByLabel('端口')
  const currentHost = await host.inputValue()
  const nextHost = currentHost === '0.0.0.0' ? '127.0.0.1' : '0.0.0.0'
  await host.fill(nextHost)
  await expect(page.getByText('请先保存监听设置，再启用远程访问。')).toBeVisible()
  await expect(page.getByRole('button', { name: '启用并创建配对' })).toBeDisabled()
  await expect(port).toHaveValue('43991')
  await page.getByRole('button', { name: '保存监听设置' }).click()
  await expect(page.getByText(`远程绑定目标: ${nextHost}:43991`)).toBeVisible()
  await expect(page.getByText('请先保存监听设置，再启用远程访问。')).toBeHidden()
  await page.screenshot({ path: testInfo.outputPath('remote-listener.png'), fullPage: true })
})

test('keeps the workspace within a mobile viewport', async ({ page }) => {
  await page.goto('/workspace')
  await expect(page.getByRole('option', { name: 'E2E project' })).toBeAttached()
  const metrics = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    workspaceHeight: document.querySelector('.daw-workspace')?.getBoundingClientRect().height ?? 0,
  }))
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.viewport + 1)
  expect(metrics.workspaceHeight).toBeGreaterThan(500)
})
