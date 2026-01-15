(function() {
    let EXTENSION_ID = null;
    const EXTENSION_URL = 'https://chromewebstore.google.com/detail/bridge/kjngblbbgmcjapdolbonbgmpccpdlpko';
    
    function injectUI(isInstalled) {
        const uploadBtn = document.getElementById('btnUpload');
        if (!uploadBtn) return;

        // Удаляем старые инъекции если они были (на случай повторного вызова)
        const existing = document.getElementById('extension-autoload-container');
        if (existing) existing.remove();

        const container = document.createElement('div');
        container.id = 'extension-autoload-container';
        container.style.marginTop = '1rem';
        container.style.textAlign = 'center';

        if (isInstalled) {
            const autoBtn = document.createElement('button');
            autoBtn.className = 'btn-primary';
            autoBtn.innerText = 'Загрузить через расширение';
            autoBtn.style.marginTop = '0.5rem';
            autoBtn.onclick = () => {
                console.log('Кнопка "Загрузить через расширение" нажата. Логика будет позже.');
            };
            container.appendChild(autoBtn);
        } else {
            const link = document.createElement('a');
            link.href = EXTENSION_URL;
            link.target = '_blank';
            link.innerText = 'Установите расширение Bridge для автозагрузки';
            link.style.color = 'var(--text-sub)';
            link.style.fontSize = '0.8rem';
            link.style.textDecoration = 'underline';
            container.appendChild(link);
        }

        uploadBtn.parentNode.insertBefore(container, uploadBtn.nextSibling);
    }

    // По умолчанию показываем ссылку, если BRIDGE_READY не пришел сразу
    // Но подождем немного, так как событие может прийти чуть позже инициализации скрипта
    let readyCalled = false;
    
    document.addEventListener('BRIDGE_READY', (event) => {
        const extensionId = event.detail.extensionId;
        if (!extensionId) { console.warn('BRIDGE_READY without extensionId!'); return; }
        if (EXTENSION_ID && extensionId !== EXTENSION_ID) { console.warn('BRIDGE_READY with different extensionId!', extensionId, EXTENSION_ID); return; }
        if (EXTENSION_ID && extensionId === EXTENSION_ID) return;

        EXTENSION_ID = extensionId;
        console.log("BRIDGE_READY extensionId:", extensionId);

        readyCalled = true;
        injectUI(true);
    });

    // Если через 1 секунду событие не пришло, считаем что расширения нет
    setTimeout(() => {
        if (!readyCalled) {
            injectUI(false);
        }
    }, 1000);
})();
