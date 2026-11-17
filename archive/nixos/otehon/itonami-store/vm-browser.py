"""NixOS VM-only Selenium acceptance of the real shared static bundle."""
import sys, shutil, subprocess, urllib.request, time, os
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
binary=shutil.which('chromium')
profile='/home/storetest/.local/state/itonami-store/chromium'
process=subprocess.Popen([binary,'--headless=new','--window-size=1280,900','--disable-gpu','--disable-dev-shm-usage','--no-first-run','--remote-debugging-address=127.0.0.1','--remote-debugging-port=9229','--user-data-dir='+profile,'about:blank'],stdout=sys.stderr,stderr=sys.stderr)
try:
    for attempt in range(180):
        if process.poll() is not None: raise RuntimeError('Chromium exited before DevTools was ready')
        try:
            urllib.request.urlopen('http://127.0.0.1:9229/json/version',timeout=2).read()
            break
        except OSError:time.sleep(2)
    else:raise RuntimeError('Chromium did not become ready under TCG')
except BaseException:
    process.terminate();raise
options=webdriver.ChromeOptions()
options.debugger_address='127.0.0.1:9229'
from selenium.webdriver.chrome.service import Service
driver=webdriver.Chrome(service=Service(shutil.which('chromedriver'),log_output='/home/storetest/chromedriver-'+sys.argv[1]+'.log'),options=options)
wait=WebDriverWait(driver,180)
def click(text):
    element=wait.until(EC.element_to_be_clickable((By.XPATH,"//button[normalize-space(.)="+repr(text)+"]")))
    driver.execute_script("arguments[0].scrollIntoView({block:'center'})",element)
    element.click()
try:
    driver.get('http://127.0.0.1:8791/')
    wait.until(EC.presence_of_element_located((By.XPATH,"//h1[text()='itonami Store']")))
    if sys.argv[1]=='create':
        click('Yotei を見る');click('追加内容を確認');click('今回の追加を確認')
    else: click('ライブラリ')
    click('Yotei を開く')
    if sys.argv[1]=='create':
        click('予定を追加')
        driver.find_element(By.ID,'event-title').send_keys('NixOS-reboot-check')
        click('保存')
    wait.until(EC.presence_of_element_located((By.XPATH,"//h2[text()='NixOS-reboot-check']")))
    driver.save_screenshot('/home/storetest/store-'+sys.argv[1]+'.png')
    print('ITONAMI_STORE_VM '+sys.argv[1]+' passed',flush=True)
finally:
    driver.quit()
    process.terminate()
    process.wait(timeout=30)
