const { ipcRenderer, shell } = require('electron');

// Application state
let currentTabId = null;
let tabs = {};
let taskCounter = 0;
let isFocusMode = false;
let focusStartTime = null;
let focusDuration = null; // Expected duration in minutes for the current focus session
let focusTimerInterval = null;
let draggedTaskId = null;
let focusedTaskId = null; // To track which task is currently in focus mode

// Basecamp State
let basecampConfig = {
    accountId: null,
    accessToken: null,
    isConnected: false
};

// DOM elements
const tabsContainer = document.querySelector('.tabs');
const tasksContainer = document.querySelector('.tasks-container');
const newTaskInput = document.getElementById('new-task-input');
const addTaskBtn = document.getElementById('add-task-btn');
const addTabBtn = document.getElementById('add-tab-btn');
const durationInputContainer = document.getElementById('duration-input-container');
const taskDurationInput = document.getElementById('task-duration-input');
const settingsBtn = document.getElementById('settings-btn');
const syncBtn = document.getElementById('sync-btn');

// Done section elements
const doneContainer = document.getElementById('done-container');
const doneTasksContainer = document.querySelector('.done-tasks');
const deleteAllBtn = document.getElementById('delete-all-btn');

// Modal elements
const tabNameModal = document.getElementById('tab-name-modal');
const modalTitle = document.getElementById('modal-title');
const tabNameInput = document.getElementById('tab-name-input');
const cancelTabBtn = document.getElementById('cancel-tab-btn');
const createTabBtn = document.getElementById('create-tab-btn');
// Basecamp Modal Elements
const basecampSelection = document.getElementById('basecamp-selection');
const bcProjectSelect = document.getElementById('bc-project-select');
const bcListSelect = document.getElementById('bc-list-select');
const bcListWrapper = document.getElementById('bc-list-wrapper');

// Settings Modal Elements
const settingsModal = document.getElementById('settings-modal');
const closeSettingsBtn = document.getElementById('close-settings-btn');
const bcAuthContainer = document.getElementById('bc-auth-container');
const bcConnectionStatus = document.getElementById('bc-connection-status');
const bcLoginForm = document.getElementById('bc-login-form');
const bcAccountIdInput = document.getElementById('bc-account-id');
const bcAccessTokenInput = document.getElementById('bc-access-token');
const connectBcBtn = document.getElementById('connect-bc-btn');
const disconnectBcBtn = document.getElementById('disconnect-bc-btn');
const bcHelpLink = document.getElementById('bc-help-link');

// Track which tab is being renamed
let renamingTabId = null;

// Focus mode elements
const normalMode = document.getElementById('normal-mode');
const focusMode = document.getElementById('focus-mode');
const focusTaskName = document.getElementById('focus-task-name');
const focusTimer = document.getElementById('focus-timer');
const exitFocusBtn = document.getElementById('exit-focus-btn');
const completeFocusBtn = document.getElementById('complete-focus-btn');

// Initialize app
function initApp() {
    // Load saved data or create default tab
    loadData();

    if (Object.keys(tabs).length === 0) {
        createNewTab('Tasks');
    }

    // Set up event listeners
    setupEventListeners();

    // Load the first tab
    switchToTab(Object.keys(tabs)[0]);
    
    // Check Basecamp connection status
    updateBasecampUI();
}

// Tab management
function createNewTab(name, bcProjectId = null, bcListId = null) {
    const tabId = `tab_${Date.now()}`;
    const tabName = name.trim() || 'New Tab';

    tabs[tabId] = {
        id: tabId,
        name: tabName,
        tasks: [],
        basecampProjectId: bcProjectId,
        basecampListId: bcListId
    };

    renderTabs();
    saveData();
    
    // If connected to Basecamp, fetch tasks immediately
    if (bcProjectId && bcListId) {
        syncBasecampList(tabId);
    }
    
    return tabId;
}

function switchToTab(tabId) {
    if (!tabs[tabId]) return;

    currentTabId = tabId;
    renderTabs();
    renderTasks();
    
    // Show/Hide sync button based on tab type
    if (tabs[tabId].basecampListId) {
        syncBtn.classList.remove('hidden');
    } else {
        syncBtn.classList.add('hidden');
    }
}

function closeTab(tabId) {
    if (Object.keys(tabs).length <= 1) {
        alert('You must have at least one tab!');
        return;
    }

    const tabIndex = Object.keys(tabs).indexOf(tabId);
    delete tabs[tabId];

    // Switch to adjacent tab or first tab
    if (currentTabId === tabId) {
        const remainingTabs = Object.keys(tabs);
        currentTabId = remainingTabs[Math.max(0, Math.min(tabIndex, remainingTabs.length - 1))];
    }

    renderTabs();
    renderTasks();
    saveData();
}

function renameTab(tabId, newName) {
    if (tabs[tabId]) {
        tabs[tabId].name = newName.trim() || 'Untitled';
        renderTabs();
        saveData();
    }
}

// Task management
function addTask(text) {
    if (!text.trim() || !currentTabId) return;

    const duration = taskDurationInput.value ? parseInt(taskDurationInput.value) : null;

    const task = {
        id: `task_${++taskCounter}`,
        text: text.trim(),
        completed: false,
        createdAt: new Date().toISOString(),
        expectedDuration: duration,
        actualDuration: null,
        basecampId: null
    };

    tabs[currentTabId].tasks.push(task);
    
    // If this is a Basecamp list, create the todo in Basecamp
    if (tabs[currentTabId].basecampListId && basecampConfig.isConnected) {
        createBasecampTodo(currentTabId, task);
    }
    
    renderTasks();
    saveData();
    
    // Reset inputs
    newTaskInput.value = '';
    taskDurationInput.value = '';
    durationInputContainer.classList.remove('visible');
    durationInputContainer.classList.remove('has-value'); // Reset this class
    addTaskBtn.disabled = true;
}

function deleteTask(taskId) {
    if (!currentTabId) return;

    tabs[currentTabId].tasks = tabs[currentTabId].tasks.filter(task => task.id !== taskId);
    renderTasks();
    saveData();
}

function toggleTask(taskId) {
    console.log('=== TOGGLE TASK START ===');
    console.log('Task ID:', taskId);
    console.log('Current tab ID:', currentTabId);

    if (!currentTabId) {
        console.log('❌ No current tab ID, returning');
        return;
    }

    const currentTab = tabs[currentTabId];
    
    const taskIndex = currentTab.tasks.findIndex(t => t.id === taskId);

    if (taskIndex === -1) {
        console.log('❌ Task not found, returning');
        return;
    }

    const task = currentTab.tasks[taskIndex];
    const wasCompleted = task.completed;
    
    // Toggle the completion status
    task.completed = !task.completed;
    
    // If the task was completed and is now incomplete, move it to the beginning
    if (wasCompleted && !task.completed) {
        console.log('✅ Condition met: was completed and now incomplete, moving to beginning');
        // Remove from current position
        currentTab.tasks.splice(taskIndex, 1);
        // Insert at the beginning
        currentTab.tasks.unshift(task);
    } 
    
    // If Basecamp connected, sync status
    if (currentTab.basecampListId && basecampConfig.isConnected && task.basecampId) {
        updateBasecampCompletion(currentTabId, task);
    }

    renderTasks();
    saveData();
}

function focusTask(taskId) {
    console.log('focusTask called with taskId:', taskId);
    if (!currentTabId) {
        console.log('❌ No currentTabId, returning');
        return;
    }

    const task = tabs[currentTabId].tasks.find(t => t.id === taskId);
    if (task) {
        focusedTaskId = taskId;
        console.log('Entering focus mode for task:', task.text);
        enterFocusMode(task.text, task.expectedDuration, task.timeSpent || 0);
    } else {
        console.log('❌ Task not found');
    }
}

// Rendering functions
function renderTabs() {
    tabsContainer.innerHTML = '';

    Object.values(tabs).forEach(tab => {
        const tabElement = document.createElement('div');
        tabElement.className = `tab ${tab.id === currentTabId ? 'active' : ''}`;
        tabElement.dataset.tabId = tab.id;

        // Tab content
        const tabContent = document.createElement('span');
        
        // Add Basecamp logo if connected
        if (tab.basecampListId) {
            const img = document.createElement('img');
            img.src = './images/basecamp_logo_icon_147315.png';
            img.style.width = '14px';
            img.style.height = '14px';
            img.style.marginRight = '6px';
            img.style.verticalAlign = 'middle';
            img.style.marginBottom = '2px';
            tabContent.appendChild(img);
        }
        
        const textNode = document.createTextNode(tab.name);
        tabContent.appendChild(textNode);
        
        tabElement.appendChild(tabContent);

        // Close button (only if more than one tab)
        if (Object.keys(tabs).length > 1) {
            const closeBtn = document.createElement('button');
            closeBtn.className = 'tab-close';
            closeBtn.textContent = '×';
            closeBtn.title = 'Close tab';
            closeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                closeTab(tab.id);
            });
            tabElement.appendChild(closeBtn);
        }

        // Click to switch tabs or rename if already active
        tabElement.addEventListener('click', () => {
            if (tab.id === currentTabId) {
                // Active tab clicked - rename it
                showRenameModal(tab.id);
            } else {
                // Inactive tab clicked - switch to it
                switchToTab(tab.id);
            }
        });

        // Double-click to rename
        tabElement.addEventListener('dblclick', (e) => {
            if (e.target.className !== 'tab-close') {
                showRenameModal(tab.id);
            }
        });

        tabsContainer.appendChild(tabElement);
    });

    // Add "Add Tab" button as a subtle plus icon after the last tab
    const addTabBtn = document.createElement('button');
    addTabBtn.className = 'add-tab-btn-subtle';
    addTabBtn.textContent = '+';
    addTabBtn.title = 'Add new tab';
    addTabBtn.addEventListener('click', () => {
        showTabNameModal();
    });
    tabsContainer.appendChild(addTabBtn);
}

function renderTasks() {
    if (!currentTabId) {
        tasksContainer.innerHTML = '<div style="text-align: center; color: #666; padding: 40px;">No tab selected</div>';
        doneContainer.style.display = 'none';
        return;
    }

    const currentTab = tabs[currentTabId];
    if (!currentTab.tasks.length) {
        tasksContainer.innerHTML = '<div style="text-align: center; color: #666; padding: 40px;">No tasks yet. Add one below!</div>';
        doneContainer.style.display = 'none';
        return;
    }

    // Separate completed and incomplete tasks
    const incompleteTasks = currentTab.tasks.filter(task => !task.completed);
    const completedTasks = currentTab.tasks.filter(task => task.completed);

    // Render incomplete tasks in main tasks container
    tasksContainer.innerHTML = '';
    if (incompleteTasks.length === 0) {
        tasksContainer.innerHTML = '<div style="text-align: center; color: #666; padding: 20px;">All tasks completed! 🎉</div>';
    } else {
        incompleteTasks.forEach(task => {
            const taskElement = createTaskElement(task);
            tasksContainer.appendChild(taskElement);
        });

        // Add invisible drag target at bottom
        const bottomDragTarget = document.createElement('div');
        bottomDragTarget.className = 'bottom-drag-target';
        bottomDragTarget.dataset.position = 'bottom';
        bottomDragTarget.addEventListener('dragover', handleBottomDragOver);
        bottomDragTarget.addEventListener('dragleave', handleBottomDragLeave);
        bottomDragTarget.addEventListener('drop', handleBottomDrop);
        tasksContainer.appendChild(bottomDragTarget);
    }

    // Render completed tasks in done container
    doneTasksContainer.innerHTML = '';
    if (completedTasks.length > 0) {
        completedTasks.forEach(task => {
            const taskElement = createTaskElement(task);
            doneTasksContainer.appendChild(taskElement);
        });

        // Add invisible drag target at bottom
        const doneBottomDragTarget = document.createElement('div');
        doneBottomDragTarget.className = 'bottom-drag-target';
        doneBottomDragTarget.dataset.position = 'bottom';
        doneBottomDragTarget.addEventListener('dragover', handleBottomDragOver);
        doneBottomDragTarget.addEventListener('dragleave', handleBottomDragLeave);
        doneBottomDragTarget.addEventListener('drop', handleBottomDrop);
        doneTasksContainer.appendChild(doneBottomDragTarget);

        doneContainer.style.display = 'block';

        // Show "Delete all" button if there's more than one completed task
        if (completedTasks.length > 1) {
            deleteAllBtn.classList.remove('hidden');
        } else {
            deleteAllBtn.classList.add('hidden');
        }
    } else {
        doneContainer.style.display = 'none';
    }
}

function createTaskElement(task) {
    const taskElement = document.createElement('div');
    taskElement.className = `task-item ${task.completed ? 'completed-task' : ''}`;
    taskElement.draggable = true;
    taskElement.dataset.taskId = task.id;

    // Build action buttons based on task completion status
    let actionButtons = '';
    if (!task.completed) {
        // Incomplete tasks get both focus and delete buttons
        actionButtons = `
            <button class="focus-btn" data-task-id="${task.id}" title="Focus on this task">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="10"/>
                    <circle cx="12" cy="12" r="6"/>
                    <circle cx="12" cy="12" r="2"/>
                </svg>
            </button>
            <button class="delete-btn" data-task-id="${task.id}">×</button>
        `;
    } else {
        // Completed tasks only get delete button
        actionButtons = `
            <button class="delete-btn" data-task-id="${task.id}">×</button>
        `;
    }

    // Prepare duration display
    let metaHtml = '';
    if (task.completed && task.actualDuration) {
        // Convert ms to minutes
        let timeDisplay;
        if (task.actualDuration < 60000) {
            timeDisplay = '<1m';
        } else {
            timeDisplay = `${Math.round(task.actualDuration / (1000 * 60))}m`;
        }
        metaHtml = `<span class="task-meta actual-time">${timeDisplay}</span>`;
    } else if (!task.completed && task.expectedDuration) {
        metaHtml = `<span class="task-meta" title="Click to edit duration">${task.expectedDuration}m</span>`;
    } else if (!task.completed) {
        // Add a placeholder meta for adding duration
        metaHtml = `<span class="task-meta add-time" title="Add duration">+</span>`;
    }

    taskElement.innerHTML = `
        <div class="drag-handle">⋮⋮</div>
        <input type="checkbox" class="task-checkbox" ${task.completed ? 'checked' : ''} data-task-id="${task.id}">
        <span class="task-text ${task.completed ? 'completed' : ''}">${task.text}</span>${metaHtml}
        <div class="task-actions">
            ${actionButtons}
        </div>
    `;

    // Prevent dragging when clicking on interactive elements
    const interactiveElements = taskElement.querySelectorAll('input, button');
    interactiveElements.forEach(el => {
        el.addEventListener('mousedown', (e) => {
            e.stopPropagation();
        });
    });
    
    const taskTextSpan = taskElement.querySelector('.task-text');
    if (taskTextSpan && !task.completed) {
        taskTextSpan.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent triggering other click handlers on the task item
            editTaskText(task.id, taskTextSpan);
        });
    }

    const taskMetaSpan = taskElement.querySelector('.task-meta');
    if (taskMetaSpan && !task.completed) {
        taskMetaSpan.addEventListener('click', (e) => {
            e.stopPropagation();
            editTaskDuration(task.id, taskMetaSpan);
        });
    }

    // Drag event listeners
    taskElement.addEventListener('dragstart', handleDragStart);
    taskElement.addEventListener('dragend', handleDragEnd);
    taskElement.addEventListener('dragover', handleDragOver);
    taskElement.addEventListener('drop', handleDrop);

    return taskElement;
}

// Event listeners
function setupEventListeners() {
    // Note: addTabBtn is now dynamically created inside renderTabs

    // Modal buttons
    if (cancelTabBtn) {
        cancelTabBtn.addEventListener('click', () => {
            hideTabNameModal();
        });
    }

    if (createTabBtn) {
        createTabBtn.addEventListener('click', () => {
            let tabName = tabNameInput.value.trim();
            
            // Get Basecamp selection
            const bcProjectId = bcProjectSelect.value;
            const bcListId = bcListSelect.value;

            // If creating from Basecamp list and name is empty, use list name
            if (bcListId && (!tabName || tabName === '')) {
                 const selectedOption = bcListSelect.options[bcListSelect.selectedIndex];
                 if (selectedOption) {
                     tabName = selectedOption.text;
                 }
            }

            if (renamingTabId) {
                // Renaming existing tab
                renameTab(renamingTabId, tabName);
            } else {
                // Creating new tab
                const newTabId = createNewTab(tabName, bcProjectId || null, bcListId || null);
                switchToTab(newTabId);
            }

            hideTabNameModal();
        });
    }

    // Settings buttons
    settingsBtn.addEventListener('click', () => {
        settingsModal.classList.remove('hidden');
    });

    closeSettingsBtn.addEventListener('click', () => {
        settingsModal.classList.add('hidden');
    });

    connectBcBtn.addEventListener('click', async () => {
        const accountId = bcAccountIdInput.value.trim();
        const token = bcAccessTokenInput.value.trim();
        
        if (accountId && token) {
            basecampConfig.accountId = accountId;
            basecampConfig.accessToken = token;
            basecampConfig.isConnected = true;
            saveData();
            updateBasecampUI();
            settingsModal.classList.add('hidden');
        }
    });

    disconnectBcBtn.addEventListener('click', () => {
        basecampConfig.accountId = null;
        basecampConfig.accessToken = null;
        basecampConfig.isConnected = false;
        saveData();
        updateBasecampUI();
    });
    
    if (bcHelpLink) {
        bcHelpLink.addEventListener('click', (e) => {
            e.preventDefault();
            shell.openExternal('https://launchpad.37signals.com/integrations');
        });
    }
    
    // Sync Button
    if (syncBtn) {
        syncBtn.addEventListener('click', () => {
            if (currentTabId && tabs[currentTabId].basecampListId) {
                syncBtn.classList.add('spinning');
                syncBasecampList(currentTabId).finally(() => {
                    setTimeout(() => syncBtn.classList.remove('spinning'), 500);
                });
            }
        });
    }
    
    // Basecamp Project Selection
    bcProjectSelect.addEventListener('change', () => {
        const projectId = bcProjectSelect.value;
        if (projectId) {
            fetchBasecampTodoLists(projectId);
            bcListWrapper.classList.remove('hidden');
        } else {
            bcListWrapper.classList.add('hidden');
        }
    });

    // Close modal on Enter key
    if (tabNameInput) {
        tabNameInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                createTabBtn.click();
            }
        });
    }

    // Close modal on Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !tabNameModal.classList.contains('hidden')) {
            hideTabNameModal();
        }
        if (e.key === 'Escape' && !settingsModal.classList.contains('hidden')) {
            settingsModal.classList.add('hidden');
        }
    });

    // Close modal when clicking outside
    if (tabNameModal) {
        tabNameModal.addEventListener('click', (e) => {
            if (e.target === tabNameModal) {
                hideTabNameModal();
            }
        });
    }
    
    if (settingsModal) {
        settingsModal.addEventListener('click', (e) => {
            if (e.target === settingsModal) {
                settingsModal.classList.add('hidden');
            }
        });
    }

    // Task events for active tasks
    tasksContainer.addEventListener('click', (e) => {
        const taskId = e.target.dataset.taskId || e.target.closest('[data-task-id]')?.dataset.taskId;

        if (!taskId) {
            return;
        }

        if (e.target.classList.contains('delete-btn') || e.target.closest('.delete-btn')) {
            deleteTask(taskId);
        } else if (e.target.classList.contains('focus-btn') || e.target.closest('.focus-btn')) {
            focusTask(taskId);
        } else if (e.target.classList.contains('task-checkbox') || e.target.closest('.task-checkbox')) {
            toggleTask(taskId);
        } else if (e.target.classList.contains('task-text')) {
            // Edit task text
            editTaskText(taskId, e.target);
        }
    });

    // Task events for completed tasks (done section)
    doneTasksContainer.addEventListener('click', (e) => {
        const taskId = e.target.dataset.taskId || e.target.closest('[data-task-id]')?.dataset.taskId;
        if (!taskId) return;

        if (e.target.classList.contains('delete-btn') || e.target.closest('.delete-btn')) {
            deleteTask(taskId);
        } else if (e.target.classList.contains('task-checkbox') || e.target.closest('.task-checkbox')) {
            toggleTask(taskId);
        }
    });

    // Add task events
    addTaskBtn.addEventListener('click', () => {
        addTask(newTaskInput.value);
    });

    newTaskInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            addTask(newTaskInput.value);
        }
    });

    newTaskInput.addEventListener('input', () => {
        const hasText = newTaskInput.value.trim().length > 0;
        addTaskBtn.disabled = !hasText;
        
        if (hasText) {
            durationInputContainer.classList.add('visible');
        } else {
            durationInputContainer.classList.remove('visible');
            // Also clear duration if task input is cleared? Maybe not.
        }
    });
    
    taskDurationInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            addTask(newTaskInput.value);
        }
    });
    
    // Toggle label visibility based on input
    taskDurationInput.addEventListener('input', () => {
        if (taskDurationInput.value.length > 0) {
            durationInputContainer.classList.add('has-value');
        } else {
            durationInputContainer.classList.remove('has-value');
        }
    });

    // Focus mode events
    exitFocusBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        exitFocusMode();
    });

    completeFocusBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        if (focusedTaskId && currentTabId) {
             // Calculate elapsed time
            const elapsed = Date.now() - focusStartTime;
            
            // Find the task and update it
            const task = tabs[currentTabId].tasks.find(t => t.id === focusedTaskId);
            if (task) {
                task.actualDuration = elapsed;
                saveData();
                
                // Toggle completion
                toggleTask(focusedTaskId);
            }
        } else if (currentTabId) {
             // Fallback to find by name if ID is missing for some reason (legacy support)
            const focusedTask = tabs[currentTabId].tasks.find(t => t.text === focusTaskName.textContent);
            if (focusedTask) {
                toggleTask(focusedTask.id);
            }
        }
        
        exitFocusMode();
    });

    // Delete all completed tasks
    if (deleteAllBtn) {
        deleteAllBtn.addEventListener('click', () => {
            if (!currentTabId || !tabs[currentTabId]) return;
            
            // Keep only incomplete tasks
            tabs[currentTabId].tasks = tabs[currentTabId].tasks.filter(task => !task.completed);
            saveData();
            renderTasks();
        });
    }

    // Custom drag implementation
    const focusContainer = document.querySelector('.focus-container');
    if (focusContainer) {
        let isDragging = false;
        let startX, startY;

        focusContainer.addEventListener('mousedown', (e) => {
            if (e.target.closest('.exit-focus-btn') || e.target.closest('.complete-focus-btn')) return; // Don't drag if clicking buttons
            
            isDragging = true;
            startX = e.screenX;
            startY = e.screenY;
            
            // Prevent text selection while dragging
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;

            const deltaX = e.screenX - startX;
            const deltaY = e.screenY - startY;

            ipcRenderer.send('window-move', { x: deltaX, y: deltaY });

            startX = e.screenX;
            startY = e.screenY;
        });

        document.addEventListener('mouseup', () => {
            isDragging = false;
        });
    }
}

// Focus mode functions
function enterFocusMode(taskName, duration = null, initialTimeSpent = 0) {
    console.log('enterFocusMode called with taskName:', taskName, 'duration:', duration, 'initialTimeSpent:', initialTimeSpent);
    isFocusMode = true;
    focusDuration = duration; // Set the duration
    
    console.log('Hiding normal mode, showing focus mode');
    normalMode.classList.add('hidden');
    focusMode.classList.remove('hidden');

    focusTaskName.textContent = taskName;
    focusTaskName.title = taskName;

    console.log('Starting focus timer');
    startFocusTimer(initialTimeSpent);

    // Calculate appropriate window width based on content
    setTimeout(() => {
        const container = document.querySelector('.focus-container');
        if (container) {
            const containerWidth = Math.min(Math.max(container.offsetWidth, 280), 500);
            console.log('Calculated container width:', containerWidth);
            ipcRenderer.send('set-focus-window-size', containerWidth);
        }
    }, 50); // Small delay to ensure DOM is updated

    console.log('Sending enter-focus-mode IPC');
    ipcRenderer.send('enter-focus-mode', taskName);
}

function exitFocusMode() {
    // Save progress if we have a focused task
    if (focusedTaskId && currentTabId && isFocusMode && focusStartTime) {
        const elapsed = Date.now() - focusStartTime;
        const task = tabs[currentTabId].tasks.find(t => t.id === focusedTaskId);
        if (task) {
             task.timeSpent = elapsed;
             saveData();
        }
    }

    isFocusMode = false;
    focusedTaskId = null; // Clear focused task ID
    focusDuration = null; // Reset duration
    stopFocusTimer();
    
    // Reset overtime style
    if (focusTimer) {
        focusTimer.classList.remove('overtime');
    }

    focusMode.classList.add('hidden');
    normalMode.classList.remove('hidden');

    ipcRenderer.send('exit-focus-mode');
}

function startFocusTimer(initialTimeSpent = 0) {
    focusStartTime = Date.now() - initialTimeSpent;
    // Update immediately
    updateFocusTimer();
    focusTimerInterval = setInterval(updateFocusTimer, 1000);
}

function stopFocusTimer() {
    if (focusTimerInterval) {
        clearInterval(focusTimerInterval);
        focusTimerInterval = null;
    }
}

function updateFocusTimer() {
    if (!isFocusMode || !focusStartTime) return;

    const elapsed = Date.now() - focusStartTime;
    let displayMs = elapsed;
    let isOvertime = false;

    if (focusDuration) {
        const totalMs = focusDuration * 60 * 1000;
        if (elapsed >= totalMs) {
            isOvertime = true;
            displayMs = elapsed - totalMs;
        } else {
            displayMs = totalMs - elapsed;
            // Round up for countdown behavior (so 100ms left shows 1s)
            displayMs = Math.ceil(displayMs / 1000) * 1000;
        }
    }

    const hours = Math.floor(displayMs / (1000 * 60 * 60));
    const minutes = Math.floor((displayMs % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((displayMs % (1000 * 60)) / 1000);

    let timeString = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    
    if (isOvertime && focusDuration) {
        timeString = `-${timeString}`;
        focusTimer.classList.add('overtime');
    } else {
        focusTimer.classList.remove('overtime');
    }

    focusTimer.textContent = timeString;
}

// Drag and drop functions
function handleDragStart(e) {
    draggedTaskId = e.target.dataset.taskId;
    e.target.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/html', e.target.outerHTML);
}

function handleDragEnd(e) {
    e.target.classList.remove('dragging');
    draggedTaskId = null;

    // Remove drag over classes
    document.querySelectorAll('.task-item.drag-over, .bottom-drag-target.drag-over').forEach(el => {
        el.classList.remove('drag-over');
    });
}

function handleDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    const target = e.target.closest('.task-item');

    // Clear all previous drag-over states
    document.querySelectorAll('.task-item.drag-over, .bottom-drag-target.drag-over').forEach(el => {
        el.classList.remove('drag-over');
    });

    if (target && target.dataset.taskId !== draggedTaskId) {
        // Dragging over a task item - show blue line above it
        target.classList.add('drag-over');
    }
}

function handleDrop(e) {
    e.preventDefault();

    const targetTask = e.target.closest('.task-item');

    if (!draggedTaskId) return;

    if (targetTask && targetTask.dataset.taskId !== draggedTaskId) {
        // Dropped on a task - reorder relative to that task
        reorderTasks(draggedTaskId, targetTask.dataset.taskId);
    }
    // Bottom drops are handled by the bottom drag targets
}

// Task reordering function
function reorderTasks(draggedId, targetId) {
    if (!currentTabId) return;

    const currentTab = tabs[currentTabId];
    const draggedIndex = currentTab.tasks.findIndex(task => task.id === draggedId);
    const targetIndex = currentTab.tasks.findIndex(task => task.id === targetId);

    if (draggedIndex === -1 || targetIndex === -1) return;

    // Remove dragged task
    const [draggedTask] = currentTab.tasks.splice(draggedIndex, 1);

    // Calculate insert position
    let insertIndex = targetIndex;

    // If we removed an item before the target, adjust the index
    if (draggedIndex < targetIndex) {
        insertIndex = targetIndex - 1;
    }

    currentTab.tasks.splice(insertIndex, 0, draggedTask);

    // Save and re-render
    saveData();
    renderTasks();
}

// Bottom drag handlers
function handleBottomDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    // Clear all drag-over states
    document.querySelectorAll('.task-item.drag-over, .bottom-drag-target.drag-over').forEach(el => {
        el.classList.remove('drag-over');
    });

    // Add drag-over to this bottom target
    e.target.classList.add('drag-over');
}

function handleBottomDragLeave(e) {
    e.target.classList.remove('drag-over');
}

function handleBottomDrop(e) {
    e.preventDefault();
    e.target.classList.remove('drag-over');

    if (draggedTaskId) {
        moveTaskToBottom(draggedTaskId);
    }
}

// Move task to bottom function
function moveTaskToBottom(taskId) {
    if (!currentTabId) return;

    const currentTab = tabs[currentTabId];
    const taskIndex = currentTab.tasks.findIndex(task => task.id === taskId);

    if (taskIndex === -1) return;

    // Remove task and add to end
    const [task] = currentTab.tasks.splice(taskIndex, 1);
    currentTab.tasks.push(task);

    // Save and re-render
    saveData();
    renderTasks();
}

function editTaskText(taskId, textElement) {
    if (!currentTabId) return;
    
    const currentTab = tabs[currentTabId];
    const task = currentTab.tasks.find(t => t.id === taskId);
    if (!task) return;

    // Create input element
    const input = document.createElement('input');
    input.type = 'text';
    input.value = task.text;
    input.className = 'task-edit-input';
    
    // Prevent drag start on input
    input.addEventListener('mousedown', (e) => {
        e.stopPropagation();
    });

    // Replace text with input
    textElement.replaceWith(input);
    input.focus();

    // Save on blur or enter
    function saveEdit() {
        const newText = input.value.trim();
        if (newText) {
            task.text = newText;
            saveData();
        }
        renderTasks(); // Re-render to restore span and update UI
    }

    input.addEventListener('blur', saveEdit);
    input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            saveEdit();
        }
    });
}

function editTaskDuration(taskId, metaElement) {
    if (!currentTabId) return;
    
    const currentTab = tabs[currentTabId];
    const task = currentTab.tasks.find(t => t.id === taskId);
    if (!task) return;

    // Create input element for duration
    const input = document.createElement('input');
    input.type = 'number';
    input.value = task.expectedDuration || '';
    input.className = 'task-edit-input';
    input.style.width = '40px';
    input.style.textAlign = 'center';
    input.min = '1';
    input.max = '999';
    input.placeholder = 'm';
    
    // Prevent drag start on input
    input.addEventListener('mousedown', (e) => {
        e.stopPropagation();
    });

    // Replace meta span with input
    metaElement.replaceWith(input);
    input.focus();

    // Save on blur or enter
    function saveEdit() {
        const newVal = input.value.trim();
        if (newVal) {
            task.expectedDuration = parseInt(newVal);
        } else {
            task.expectedDuration = null; // Clear if empty
        }
        saveData();
        renderTasks(); // Re-render to restore span and update UI
    }

    input.addEventListener('blur', saveEdit);
    input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            saveEdit();
        }
    });
}

// Modal functions
function showTabNameModal() {
    renamingTabId = null;
    modalTitle.textContent = 'Enter list name';
    createTabBtn.textContent = 'Create';
    tabNameInput.value = '';
    tabNameInput.placeholder = 'My to-do list'; 
    tabNameModal.classList.remove('hidden');
    
    // Handle Basecamp visibility
    if (basecampConfig.isConnected) {
        basecampSelection.classList.remove('hidden');
        bcProjectSelect.innerHTML = '<option value="">Select a project...</option>';
        bcListSelect.innerHTML = '<option value="">Select a list...</option>';
        bcListWrapper.classList.add('hidden');
        
        fetchBasecampProjects().then(projects => {
            if (projects.length === 0) {
                bcProjectSelect.innerHTML = '<option value="">No projects found</option>';
            } else {
                projects.forEach(p => {
                    const opt = document.createElement('option');
                    opt.value = p.id;
                    opt.textContent = p.name;
                    bcProjectSelect.appendChild(opt);
                });
            }
        });
    } else {
        basecampSelection.classList.add('hidden');
    }
    
    tabNameInput.focus();
}

function showRenameModal(tabId) {
    renamingTabId = tabId;
    const tab = tabs[tabId];
    if (tab) {
        modalTitle.textContent = 'Rename tab';
        createTabBtn.textContent = 'Rename';
        tabNameInput.value = tab.name;
        basecampSelection.classList.add('hidden'); // Don't show BC select on rename
        tabNameModal.classList.remove('hidden');
        tabNameInput.focus();
        tabNameInput.select();
    }
}

function hideTabNameModal() {
    tabNameModal.classList.add('hidden');
    tabNameInput.value = '';
    renamingTabId = null;
}

// IPC listeners
ipcRenderer.on('enter-focus-mode', (event, taskName) => {
    enterFocusMode(taskName);
});

ipcRenderer.on('exit-focus-mode', () => {
    exitFocusMode();
});

// Data persistence
function saveData() {
    const data = {
        tabs: tabs,
        currentTabId: currentTabId,
        taskCounter: taskCounter,
        basecampConfig: basecampConfig
    };
    localStorage.setItem('redd-todo-data', JSON.stringify(data));
}

function loadData() {
    try {
        // Try loading new data key first
        let data = JSON.parse(localStorage.getItem('redd-todo-data'));
        
        // Fallback to old key for migration (if we are in the same storage context)
        if (!data) {
            data = JSON.parse(localStorage.getItem('redd-task-data'));
            if (data) {
                // Migrate to new key
                localStorage.setItem('redd-todo-data', JSON.stringify(data));
                // Optional: localStorage.removeItem('redd-task-data');
            }
        }

        if (data) {
            tabs = data.tabs || {};
            currentTabId = data.currentTabId || null;
            taskCounter = data.taskCounter || 0;
            basecampConfig = data.basecampConfig || { accountId: null, accessToken: null, isConnected: false };
        }
    } catch (e) {
        console.error('Failed to load data:', e);
    }
}

// Basecamp API Logic
function updateBasecampUI() {
    if (basecampConfig.isConnected) {
        bcConnectionStatus.classList.remove('hidden');
        bcLoginForm.classList.add('hidden');
        disconnectBcBtn.classList.remove('hidden');
        bcAccountIdInput.value = basecampConfig.accountId;
        bcAccessTokenInput.value = basecampConfig.accessToken;
    } else {
        bcConnectionStatus.classList.add('hidden');
        bcLoginForm.classList.remove('hidden');
        disconnectBcBtn.classList.add('hidden');
        bcAccountIdInput.value = '';
        bcAccessTokenInput.value = '';
    }
}

async function fetchBasecampProjects() {
    if (!basecampConfig.isConnected) return [];
    try {
        // Basecamp 3 API: GET /projects.json
        const response = await fetch(`https://3.basecampapi.com/${basecampConfig.accountId}/projects.json`, {
            headers: {
                'Authorization': `Bearer ${basecampConfig.accessToken}`,
                'Content-Type': 'application/json'
            }
        });
        if (!response.ok) throw new Error('Failed to fetch projects');
        return await response.json();
    } catch (e) {
        console.error('Basecamp Error:', e);
        return [];
    }
}

async function fetchBasecampTodoLists(projectId) {
    try {
        // 1. Get the "todoset" (dock) for the project
        const projectResp = await fetch(`https://3.basecampapi.com/${basecampConfig.accountId}/projects/${projectId}.json`, {
            headers: { 'Authorization': `Bearer ${basecampConfig.accessToken}` }
        });
        const projectData = await projectResp.json();
        
        const todoset = projectData.dock.find(d => d.name === 'todoset');
        if (!todoset) return;

        // 2. Get the todolists in that set
        const listsResp = await fetch(todoset.url, {
            headers: { 'Authorization': `Bearer ${basecampConfig.accessToken}` }
        });
        const listsData = await listsResp.json();
        
        // Populate select
        bcListSelect.innerHTML = '<option value="">Select a list...</option>';
        // In BC3, listsResp itself might be the list of todolists or the set details containing 'todolists_url'
        // Actually: GET /buckets/1/todosets/1/todolists.json
        const realListsUrl = todoset.url.replace('.json', '/todolists.json');
        
        const finalListsResp = await fetch(realListsUrl, {
             headers: { 'Authorization': `Bearer ${basecampConfig.accessToken}` }
        });
        const finalLists = await finalListsResp.json();

        finalLists.forEach(list => {
            const opt = document.createElement('option');
            opt.value = list.id;
            opt.textContent = list.name;
            bcListSelect.appendChild(opt);
        });
    } catch (e) {
        console.error('Basecamp Lists Error:', e);
    }
}

async function syncBasecampList(tabId) {
    const tab = tabs[tabId];
    if (!tab || !tab.basecampListId || !basecampConfig.isConnected) return;

    try {
        const url = `https://3.basecampapi.com/${basecampConfig.accountId}/buckets/${tab.basecampProjectId}/todolists/${tab.basecampListId}/todos.json`;
        const response = await fetch(url, {
            headers: { 'Authorization': `Bearer ${basecampConfig.accessToken}` }
        });
        const remoteTodos = await response.json();

        // Merge logic: 
        // 1. Add new remote todos to local
        // 2. Update status of linked todos
        
        let changes = false;
        remoteTodos.forEach(remote => {
            const localTask = tab.tasks.find(t => t.basecampId === remote.id);
            
            if (localTask) {
                // Update local status if remote changed
                if (localTask.completed !== remote.completed) {
                    localTask.completed = remote.completed;
                    changes = true;
                }
            } else {
                // New task from remote
                tab.tasks.push({
                    id: `task_${++taskCounter}`,
                    text: remote.content,
                    completed: remote.completed,
                    createdAt: remote.created_at,
                    expectedDuration: null,
                    actualDuration: null,
                    basecampId: remote.id
                });
                changes = true;
            }
        });

        if (changes) {
            renderTasks();
            saveData();
        }
    } catch (e) {
        console.error('Sync Error:', e);
        alert('Failed to sync with Basecamp. Check your connection.');
    }
}

async function updateBasecampCompletion(tabId, task) {
    const tab = tabs[tabId];
    if (!tab || !task.basecampId) return;

    try {
        const url = `https://3.basecampapi.com/${basecampConfig.accountId}/buckets/${tab.basecampProjectId}/todos/${task.basecampId}/completion.json`;
        
        const method = task.completed ? 'POST' : 'DELETE';
        
        await fetch(url, {
            method: method,
            headers: {
                'Authorization': `Bearer ${basecampConfig.accessToken}`
            }
        });
    } catch (e) {
        console.error('Update BC Error:', e);
    }
}

async function createBasecampTodo(tabId, task) {
    const tab = tabs[tabId];
    if (!tab || !tab.basecampListId) return;

    try {
        const url = `https://3.basecampapi.com/${basecampConfig.accountId}/buckets/${tab.basecampProjectId}/todolists/${tab.basecampListId}/todos.json`;
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${basecampConfig.accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ content: task.text })
        });
        const data = await response.json();
        
        // Link local task to remote ID
        task.basecampId = data.id;
        saveData();
    } catch (e) {
        console.error('Create BC Error:', e);
    }
}

// Initialize the app when DOM is loaded
document.addEventListener('DOMContentLoaded', initApp);
