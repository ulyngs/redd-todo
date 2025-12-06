const { ipcRenderer, shell } = require('electron');

// Application state
let currentGroupId = null;
let groups = {};
let currentTabId = null;
let tabs = {};
let taskCounter = 0;
let isFocusMode = false;
let isDoneCollapsed = false; // New state for done section
let doneMaxHeight = 140; // New state for done section resize
let enableGroups = false; // Feature toggle for tab groups
let focusStartTime = null;
let focusDuration = null; // Expected duration in minutes for the current focus session
let focusTimerInterval = null;
    // Track dragged items
    let draggedTaskId = null;
    let draggedTabId = null;
    let focusedTaskId = null; // To track which task is currently in focus mode

// Basecamp State
let basecampConfig = {
    accountId: null,
    accessToken: null,
    refreshToken: null,
    clientId: null,
    clientSecret: null,
    email: null,
    isConnected: false
};

// DOM elements
const groupsContainer = document.querySelector('.groups');
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
const doneTimeSpent = document.getElementById('done-time-spent');

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
const bcEmailInput = document.getElementById('bc-email');
const bcAccessTokenInput = document.getElementById('bc-access-token');
const bcRefreshTokenInput = document.getElementById('bc-refresh-token');
const bcClientIdInput = document.getElementById('bc-client-id');
const bcClientSecretInput = document.getElementById('bc-client-secret');
const connectBcBtn = document.getElementById('connect-bc-btn');
const disconnectBcBtn = document.getElementById('disconnect-bc-btn');
const bcHelpLink = document.getElementById('bc-help-link');
// New elements
const oauthConnectBtn = document.getElementById('oauth-connect-btn');
const toggleManualAuthBtn = document.getElementById('toggle-manual-auth');
const manualAuthFields = document.getElementById('manual-auth-fields');
const bcAccountInfo = document.getElementById('bc-account-info');

// Delete Confirm Modal Elements
const deleteConfirmModal = document.getElementById('delete-confirm-modal');
const deleteConfirmMessage = document.getElementById('delete-confirm-message');
const cancelDeleteBtn = document.getElementById('cancel-delete-btn');
const confirmDeleteBtn = document.getElementById('confirm-delete-btn');

// Undo Elements
const undoToast = document.getElementById('undo-toast');
const undoMessage = document.getElementById('undo-message');
const undoBtn = document.getElementById('undo-btn');
const closeUndoBtn = document.getElementById('close-undo-btn');

// Track which tab is being renamed
let renamingTabId = null;
// Track which group is being renamed
let renamingGroupId = null;
// Track which tab is pending deletion
let pendingDeleteTabId = null;
// Track which group is pending deletion
let pendingDeleteGroupId = null;

// Undo State
let lastDeletedItem = null; // { type: 'tab'|'group', data: object, index: number, ... }
let undoTimeout = null;

// Focus mode elements
const normalMode = document.getElementById('normal-mode');
const focusMode = document.getElementById('focus-mode');
const focusTaskName = document.getElementById('focus-task-name');
const focusTimer = document.getElementById('focus-timer');
const exitFocusBtn = document.getElementById('exit-focus-btn');
const completeFocusBtn = document.getElementById('complete-focus-btn');
const resetFocusBtn = document.getElementById('reset-focus-btn');
const fullscreenFocusBtn = document.getElementById('fullscreen-focus-btn');

// Initialize app
function initApp() {
    // Load saved data or create default tab
    loadData();

    // Apply saved max height
    if (doneMaxHeight) {
        doneContainer.style.maxHeight = `${doneMaxHeight}px`;
    }

    // Migration: Create default group if none exists
    if (Object.keys(groups).length === 0) {
        createGroup('General');
    } else if (!currentGroupId || !groups[currentGroupId]) {
        // If we have groups but invalid current ID, pick first
        currentGroupId = Object.keys(groups)[0];
    }

    // Migration: Assign orphan tabs to current group
    let hasOrphans = false;
    Object.values(tabs).forEach(tab => {
        if (!tab.groupId) {
            tab.groupId = currentGroupId;
            hasOrphans = true;
        }
    });
    if (hasOrphans) saveData();

    if (Object.keys(tabs).length === 0) {
        createNewTab('Tasks');
    }

    // Set up event listeners
    setupEventListeners();

    // Render groups
    renderGroups();

    // Load the first tab of current group
    const currentGroupTabs = Object.values(tabs).filter(t => t.groupId === currentGroupId);
    if (currentGroupTabs.length > 0) {
        // If current tab is in current group, stay on it, otherwise switch to first in group
        if (!tabs[currentTabId] || tabs[currentTabId].groupId !== currentGroupId) {
            switchToTab(currentGroupTabs[0].id);
        } else {
             // Just render tabs
             renderTabs();
             renderTasks();
        }
    } else if (Object.keys(tabs).length > 0) {
         // Should not happen if we migrate correctly, but safety fallback
         renderTabs();
         renderTasks();
    }
    
    // Check Basecamp connection status
    updateBasecampUI();

    // Show window controls on non-Mac platforms
    if (process.platform !== 'darwin') {
        const winControls = document.getElementById('window-controls');
        if (winControls) {
            winControls.classList.remove('hidden');
        }
    }
}

// Group Management
function createGroup(name) {
    const groupId = `group_${Date.now()}`;
    const groupName = name.trim() || 'New Group';
    
    groups[groupId] = {
        id: groupId,
        name: groupName,
        order: Object.keys(groups).length
    };
    
    saveData();
    switchToGroup(groupId);
    return groupId;
}

function switchToGroup(groupId) {
    if (!groups[groupId]) return;
    
    currentGroupId = groupId;
    renderGroups();
    
    // Switch to first tab in this group
    const groupTabs = Object.values(tabs).filter(t => t.groupId === groupId);
    if (groupTabs.length > 0) {
        switchToTab(groupTabs[0].id);
    } else {
        // No tabs in this group?
        currentTabId = null;
        renderTabs();
        renderTasks();
    }
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
        basecampListId: bcListId,
        groupId: currentGroupId // Assign to current group
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

    // Ensure we are in the right group (in case we switch programmatically)
    if (tabs[tabId].groupId && tabs[tabId].groupId !== currentGroupId) {
        currentGroupId = tabs[tabId].groupId;
        renderGroups();
    }

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

    const tab = tabs[tabId];
    if (tab.tasks && tab.tasks.length > 0) {
        const completedCount = tab.tasks.filter(t => t.completed).length;
        const uncompletedCount = tab.tasks.length - completedCount;
        
        const confirmMessage = `Are you sure you wanted to delete the todo-list <strong>'${tab.name}'</strong>, with ${uncompletedCount} uncompleted and ${completedCount} completed tasks?`;
        
        showDeleteConfirmModal(tabId, confirmMessage);
        return;
    }

    performTabDeletion(tabId);
}

function performTabDeletion(tabId) {
    if (!tabs[tabId]) return;

    const tabIndex = Object.keys(tabs).indexOf(tabId);
    
    // Save for undo
    lastDeletedItem = {
        type: 'tab',
        data: JSON.parse(JSON.stringify(tabs[tabId])), // Deep copy
        index: tabIndex,
        originalGroupId: tabs[tabId].groupId
    };
    showUndoToast(`List '${tabs[tabId].name}' deleted`);

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

// Undo Functions
function showUndoToast(message) {
    undoMessage.textContent = message;
    undoToast.classList.remove('hidden');
    
    // Clear existing timeout
    if (undoTimeout) clearTimeout(undoTimeout);
    
    // Auto hide after 5 seconds
    undoTimeout = setTimeout(() => {
        hideUndoToast();
    }, 5000);
}

function hideUndoToast() {
    undoToast.classList.add('hidden');
    if (undoTimeout) clearTimeout(undoTimeout);
}

function performUndo() {
    if (!lastDeletedItem) return;
    
    if (lastDeletedItem.type === 'tab') {
        const tab = lastDeletedItem.data;
        tabs[tab.id] = tab;
        
        // Switch to restored tab
        switchToTab(tab.id);
        
    } else if (lastDeletedItem.type === 'group') {
        const group = lastDeletedItem.data;
        const groupTabs = lastDeletedItem.tabs;
        
        // Restore group
        groups[group.id] = group;
        
        // Restore tabs
        groupTabs.forEach(tab => {
            tabs[tab.id] = tab;
        });
        
        // Switch to restored group
        currentGroupId = group.id;
        renderGroups();
        
        if (groupTabs.length > 0) {
            switchToTab(groupTabs[0].id);
        }
    }
    
    lastDeletedItem = null;
    hideUndoToast();
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

function renameGroup(groupId, newName) {
    if (groups[groupId]) {
        groups[groupId].name = newName.trim() || 'Untitled Group';
        renderGroups();
        saveData();
    }
}

function deleteGroup(groupId) {
    if (Object.keys(groups).length <= 1) {
        alert('You must have at least one group!');
        return;
    }

    const group = groups[groupId];
    const groupTabs = Object.values(tabs).filter(t => t.groupId === groupId);
    
    if (groupTabs.length > 0) {
        let totalTasks = 0;
        let completedTasks = 0;
        
        groupTabs.forEach(tab => {
            if (tab.tasks) {
                totalTasks += tab.tasks.length;
                completedTasks += tab.tasks.filter(t => t.completed).length;
            }
        });
        
        const uncompletedTasks = totalTasks - completedTasks;
        
        const confirmMessage = `Are you sure you want to delete the group <strong>'${group.name}'</strong>?<br><br>This will delete <strong>${groupTabs.length} lists</strong> containing ${uncompletedTasks} uncompleted and ${completedTasks} completed tasks.`;
        
        showGroupDeleteConfirmModal(groupId, confirmMessage);
        return;
    }

    performGroupDeletion(groupId);
}

function performGroupDeletion(groupId) {
    if (!groups[groupId]) return;

    // Delete all tabs in this group
    const groupTabs = Object.values(tabs).filter(t => t.groupId === groupId);
    
    // Save for undo
    lastDeletedItem = {
        type: 'group',
        data: JSON.parse(JSON.stringify(groups[groupId])),
        tabs: JSON.parse(JSON.stringify(groupTabs)), // Save tabs too
        index: groups[groupId].order // Store order/index
    };
    showUndoToast(`Group '${groups[groupId].name}' deleted`);
    
    groupTabs.forEach(tab => {
        delete tabs[tab.id];
    });

    // Delete the group
    delete groups[groupId];

    // Switch to another group if we deleted the current one
    if (currentGroupId === groupId) {
        const remainingGroups = Object.keys(groups);
        currentGroupId = remainingGroups[0];
    }
    
    // If we switched groups, we need to pick a valid tab in the new group
    const currentGroupTabs = Object.values(tabs).filter(t => t.groupId === currentGroupId);
    if (currentGroupTabs.length > 0) {
        switchToTab(currentGroupTabs[0].id);
    } else {
        currentTabId = null;
    }

    renderGroups();
    renderTabs();
    renderTasks();
    saveData();
}

// Task management
function addTask(text) {
    if (!text.trim()) return;

    // If no tab is selected (e.g. empty group), create one
    if (!currentTabId) {
        const newTabId = createNewTab('New list');
        switchToTab(newTabId);
        // Wait for render updates if necessary, but synchronous is fine usually.
        // Just ensure currentTabId is set.
    }

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

    const currentTab = tabs[currentTabId];
    const task = currentTab.tasks.find(t => t.id === taskId);
    
    if (task) {
        // If Basecamp connected, delete remote
        if (currentTab.basecampListId && basecampConfig.isConnected && task.basecampId) {
            deleteBasecampTodo(currentTabId, task.basecampId);
        }

        currentTab.tasks = currentTab.tasks.filter(t => t.id !== taskId);
        renderTasks();
        saveData();
    }
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

// Tab drag and drop functions
function handleTabDragStart(e) {
    draggedTabId = e.target.dataset.tabId;
    e.target.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    // Set drag image or data if needed, though usually automatic
}

function handleTabDragEnd(e) {
    e.target.classList.remove('dragging');
    draggedTabId = null;
    
    document.querySelectorAll('.tab.drag-over').forEach(el => {
        el.classList.remove('drag-over');
    });
}

function handleTabDragOver(e) {
    e.preventDefault();
    if (!draggedTabId) return;
    
    const target = e.target.closest('.tab');
    if (target && target.dataset.tabId !== draggedTabId) {
        e.dataTransfer.dropEffect = 'move';
        
        document.querySelectorAll('.tab.drag-over').forEach(el => {
            el.classList.remove('drag-over');
        });
        target.classList.add('drag-over');
    }
}

function handleTabDrop(e) {
    e.preventDefault();
    const target = e.target.closest('.tab');
    
    if (draggedTabId && target && target.dataset.tabId !== draggedTabId) {
        reorderTabs(draggedTabId, target.dataset.tabId);
    }
    
    document.querySelectorAll('.tab.drag-over').forEach(el => {
        el.classList.remove('drag-over');
    });
}

function reorderTabs(draggedId, targetId) {
    const tabIds = Object.keys(tabs);
    const draggedIndex = tabIds.indexOf(draggedId);
    const targetIndex = tabIds.indexOf(targetId);
    
    if (draggedIndex === -1 || targetIndex === -1) return;
    
    // Create new ordered object
    const newTabs = {};
    const tabArray = Object.entries(tabs);
    const [draggedEntry] = tabArray.splice(draggedIndex, 1);
    
    // If moving right (higher index), we need to adjust target index because removal shifted indices
    // But splice logic is cleaner if we just use the target index logic similar to tasks
    // Let's reconstruct the array
    
    // We need to know if we are dropping BEFORE or AFTER the target
    // Typically simpler to just insert at target index
    
    let insertIndex = targetIndex;
    if (draggedIndex < targetIndex) {
        // If dragging from left to right, we want to insert AFTER the target? 
        // Or standard "insert before" logic. 
        // Actually, in list reordering:
        // [A, B, C, D] -> Drag A to C. Target is C.
        // Remove A: [B, C, D]. Target C is at index 1. Insert at 1: [B, A, C, D] -> effectively swapped?
        // Usually we want to insert AT the position, shifting others right.
        // If I drag A (0) to C (2), I expect [B, C, A, D] or [B, A, C, D]?
        // Let's stick to "insert before target". 
        // But if I drag A to C, and drop, it goes before C.
        // If I drag C to A, and drop, it goes before A.
        
        // Correction: `splice` insert puts it AT index, pushing existing element at that index to the right.
        // So if I have [A, B, C], drag A to C. Remove A -> [B, C]. Target C is index 1. Splice(1, 0, A) -> [B, A, C].
        // This feels like "swapping" or "placing before".
        
        // To enable placing "after" the last item, we usually need drop targets. 
        // But for tabs, "place before" is usually fine enough as long as you can reach the end.
        // Since we can't easily drop "after" the last element without a specific target or logic, 
        // let's refine:
        // If draggedIndex < targetIndex (moving right), we probably want to insert AFTER the target visual, 
        // which effectively means index should be targetIndex (since target shifted left).
        // Wait, if [A, B, C]. Remove A -> [B, C]. Target C is index 1. 
        // If I want [B, C, A], I need to insert at index 2.
        // So if dragged < target, insertIndex = targetIndex.
        // If dragged > target (moving left), [A, B, C]. Drag C to A. Remove C -> [A, B]. Target A is index 0. 
        // Insert at 0 -> [C, A, B]. Correct.
        
        // However, standard splice behavior:
        // const arr = ['A', 'B', 'C']; 
        // Remove 'A' (idx 0): ['B', 'C']. Target 'C' is now idx 1.
        // If I want it before C: splice(1, 0, 'A') -> ['B', 'A', 'C'].
        // If I want it after C: splice(2, 0, 'A') -> ['B', 'C', 'A'].
        
        // Let's stick to a simple "insert at target index" approach which effectively puts it "before" the target.
        // BUT, if moving right, the target has shifted left by 1.
        // original indices: A:0, B:1, C:2.
        // Drag A to C.
        // Remove A. Array is [B, C]. C is at 1.
        // If we use original target index (2), we insert at 2 (end). -> [B, C, A]. 
        // This feels natural for "drag A onto C".
        
        // Let's try simply:
        // 1. Convert tabs to array of entries
        // 2. Remove dragged entry
        // 3. Insert at target index (adjusting if needed)
        
        // Actually, let's use the same logic as tasks:
        // if (draggedIndex < targetIndex) insertIndex = targetIndex;
        // else insertIndex = targetIndex; 
        
        // Wait, in task logic:
        // if (draggedIndex < targetIndex) insertIndex = targetIndex - 1;
        // That was because we hadn't removed it yet? No, we did splice.
        // Let's look at task logic again:
        // const [draggedTask] = currentTab.tasks.splice(draggedIndex, 1);
        // let insertIndex = targetIndex;
        // if (draggedIndex < targetIndex) insertIndex = targetIndex - 1;
        // currentTab.tasks.splice(insertIndex, 0, draggedTask);
        
        // Let's copy that logic, it worked for tasks.
         if (draggedIndex < targetIndex) {
            insertIndex = targetIndex; // Note: In tasks I did targetIndex - 1, let's verify why.
            // Tasks: [A, B, C]. Drag A(0) to C(2). 
            // Splice A: [B, C]. C is at 1.
            // targetIndex was 2. 
            // If I use 2-1 = 1. Insert at 1: [B, A, C].
            // If I used 2. Insert at 2: [B, C, A].
            // Usually dropping ON C means "put before C" or "swap with C".
            // If I want to put after C, I need to drop past C.
            // Let's stick to "insert before target" logic.
            
            insertIndex = targetIndex - 1;
        }
    }

    // Wait, simpler logic for array reordering:
    // 1. Get array of keys.
    // 2. Remove dragged key.
    // 3. Find index of target key in remaining array.
    // 4. Insert dragged key before target key.
    
    // Let's do that, it's more robust than index math pre-removal.
    const keys = Object.keys(tabs);
    const remainingKeys = keys.filter(k => k !== draggedId);
    const newTargetIndex = remainingKeys.indexOf(targetId);
    
    // If we are dragging right and dropping on a target, we usually expect it to go AFTER if we passed the center, 
    // but simple "insert before" is standard.
    // Exception: If we are dragging from left to right, and drop on the last item, we might want it to be last?
    // "Insert before" means we can never make it the last item by dropping on the last item.
    // We would need a drop target after the last item.
    // OR, we change logic: if dragging right, place AFTER target. If dragging left, place BEFORE target.
    
    let finalIndex = newTargetIndex;
    if (draggedIndex < targetIndex) {
        // Dragging right: Insert AFTER target
        finalIndex = newTargetIndex + 1;
    } else {
        // Dragging left: Insert BEFORE target
        finalIndex = newTargetIndex;
    }
    
    remainingKeys.splice(finalIndex, 0, draggedId);
    
    // Reconstruct tabs object
    remainingKeys.forEach(key => {
        newTabs[key] = tabs[key];
    });
    
    tabs = newTabs;
    saveData();
    renderTabs();
}

// Rendering functions
function renderGroups() {
    if (!enableGroups) {
        groupsContainer.style.display = 'none';
        return;
    }
    groupsContainer.style.display = 'flex';
    groupsContainer.innerHTML = '';

    Object.values(groups).sort((a, b) => (a.order || 0) - (b.order || 0)).forEach(group => {
        const groupElement = document.createElement('div');
        groupElement.className = `group-tab ${group.id === currentGroupId ? 'active' : ''}`;
        groupElement.dataset.groupId = group.id;
        // groupElement.draggable = true; // Enable if we want to reorder groups later

        // Group content
        const groupContent = document.createElement('span');
        groupContent.textContent = group.name;
        groupElement.appendChild(groupContent);

        // Click to switch group or rename
        groupElement.addEventListener('click', () => {
            if (group.id !== currentGroupId) {
                switchToGroup(group.id);
            } else {
                showGroupRenameModal(group.id);
            }
        });

        // Add delete button if more than one group AND it is the current group
        if (Object.keys(groups).length > 1 && group.id === currentGroupId) {
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'group-delete-btn';
            deleteBtn.textContent = '×';
            deleteBtn.title = 'Delete group';
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                deleteGroup(group.id);
            });
            groupElement.appendChild(deleteBtn);
        }

        // Drag and drop (Drop target for tabs)
        groupElement.addEventListener('dragover', handleGroupDragOver);
        groupElement.addEventListener('drop', handleGroupDrop);
        groupElement.addEventListener('dragleave', handleGroupDragLeave);

        groupsContainer.appendChild(groupElement);
    });

    // Add "Add Group" button
    const addGroupBtn = document.createElement('button');
    addGroupBtn.className = 'add-group-btn';
    addGroupBtn.textContent = '+';
    addGroupBtn.title = 'Add new group';
    addGroupBtn.addEventListener('click', () => {
        // Simple prompt for now
        // TODO: Use a nicer modal similar to tab creation
        // For simplicity/MVP, we can reuse the modal or just prompt
        // Let's reuse the modal logic but tweaked, or just a prompt for now to keep it simple as requested "simple way"
        // A prompt is simplest:
        /*
        const name = prompt('Enter group name:');
        if (name) createGroup(name);
        */
       // Better: Reuse tab modal but set a flag? Or just use standard prompt for MVP.
       // Let's stick to prompt for speed, can upgrade later.
       // Actually, user said "clicking a plus just like for the existing tabs".
       // The existing tabs use a custom modal. It would be nice to use that.
       // Let's make showTabNameModal handle groups too.
       showGroupModal();
    });
    groupsContainer.appendChild(addGroupBtn);
}

function showGroupModal() {
    // Reuse tab modal for groups
    modalTitle.textContent = 'Enter group name';
    createTabBtn.textContent = 'Create Group';
    tabNameInput.value = '';
    tabNameInput.placeholder = 'My Group'; 
    tabNameModal.classList.remove('hidden');
    
    // Handle Basecamp visibility
    if (basecampConfig.isConnected) {
        basecampSelection.classList.remove('hidden');
        bcProjectSelect.innerHTML = '<option value="">Select a project...</option>';
        bcListWrapper.classList.add('hidden'); // No list selection for groups initially
        
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
    
    // We need to know we are creating a group
    // Let's attach a temporary handler or flag
    tabNameModal.dataset.mode = 'group';
    
    tabNameInput.focus();
}

function showGroupRenameModal(groupId) {
    renamingGroupId = groupId;
    const group = groups[groupId];
    if (group) {
        modalTitle.textContent = 'Rename group';
        createTabBtn.textContent = 'Rename';
        tabNameInput.value = group.name;
        tabNameModal.classList.remove('hidden');
        basecampSelection.classList.add('hidden');
        tabNameModal.dataset.mode = 'group-rename';
        tabNameInput.focus();
        tabNameInput.select();
    }
}

// Update existing modal handler to check mode
async function handleModalCreate() {
    const mode = tabNameModal.dataset.mode;
    let name = tabNameInput.value.trim();
    
    if (mode === 'group') {
        // Check if Basecamp project is selected
        const bcProjectId = bcProjectSelect.value;
        const isImporting = bcProjectId && basecampConfig.isConnected;

        if (isImporting) {
            createTabBtn.textContent = 'Importing...';
            createTabBtn.disabled = true;
        }

        const groupId = createGroup(name);
        
        if (isImporting) {
            try {
                // Fetch all todo lists from the project
                const lists = await getBasecampTodoLists(bcProjectId);
                
                // Create tabs for each list
                // Use for...of to allow await if we needed sequential async operations, 
                // but createNewTab is sync (except for the syncBasecampList call which is async background)
                // We want to trigger sync for all of them.
                
                for (const list of lists) {
                    createNewTab(list.name, bcProjectId, list.id);
                }
                
                // After creating all tabs, we might want to re-render or switch to the first one?
                // createNewTab already saves and renders.
                // Maybe switch to the first imported tab?
                // The last created tab will be active because createNewTab switches to it?
                // Actually createNewTab calls switchToTab at the end if we want? 
                // Wait, my createNewTab implementation DOES NOT call switchToTab automatically?
                // Let's check createNewTab...
                // It returns tabId. It does renderTabs() and saveData().
                // It calls syncBasecampList(tabId) if connected.
                // It DOES NOT call switchToTab.
                // Wait, in the event listener for creating a NEW tab (not group), it calls switchToTab(newTabId).
                
                // So here, we should decide which tab to switch to. 
                // Probably the first one.
                const groupTabs = Object.values(tabs).filter(t => t.groupId === groupId);
                if (groupTabs.length > 0) {
                    switchToTab(groupTabs[0].id);
                }
                
            } catch (e) {
                console.error('Import Error:', e);
                alert('Failed to import all lists from Basecamp.');
            } finally {
                createTabBtn.textContent = 'Create Group';
                createTabBtn.disabled = false;
            }
        }

        hideTabNameModal();
        tabNameModal.dataset.mode = ''; // Reset
        return;
    } else if (mode === 'group-rename') {
        renameGroup(renamingGroupId, name);
        hideTabNameModal();
        tabNameModal.dataset.mode = ''; // Reset
        renamingGroupId = null;
        return;
    }

    // Existing tab creation logic...
    // (We need to update setupEventListeners to use this function instead of inline)
}

// Group Drag Handlers
function handleGroupDragOver(e) {
    e.preventDefault();
    // Only allow dropping tabs
    if (draggedTabId) {
        e.dataTransfer.dropEffect = 'move';
        const target = e.target.closest('.group-tab');
        if (target) {
            target.classList.add('drag-over');
        }
    }
}

function handleGroupDragLeave(e) {
    const target = e.target.closest('.group-tab');
    if (target) {
        target.classList.remove('drag-over');
    }
}

function handleGroupDrop(e) {
    e.preventDefault();
    const target = e.target.closest('.group-tab');
    
    if (target) {
        target.classList.remove('drag-over');
        const targetGroupId = target.dataset.groupId;
        
        if (draggedTabId && targetGroupId) {
            moveTabToGroup(draggedTabId, targetGroupId);
        }
    }
}

function moveTabToGroup(tabId, targetGroupId) {
    if (tabs[tabId]) {
        // Update group ID
        tabs[tabId].groupId = targetGroupId;
        saveData();
        
        // Refresh view
        renderTabs();
        renderGroups(); // Optional, maybe to show count?
        
        // If we moved the active tab to another group, deciding what to do
        // Usually we stay on current group. So the tab disappears from view.
        if (tabId === currentTabId && currentGroupId !== targetGroupId) {
            // Switch to another tab in current group or clear selection
            const currentGroupTabs = Object.values(tabs).filter(t => t.groupId === currentGroupId && t.id !== tabId);
            if (currentGroupTabs.length > 0) {
                switchToTab(currentGroupTabs[0].id);
            } else {
                currentTabId = null;
                renderTabs();
                renderTasks();
            }
        }
    }
}

function renderTabs() {
    tabsContainer.innerHTML = '';

    // Filter tabs by current group only if groups are enabled
    let tabsToRender = Object.values(tabs);
    if (enableGroups) {
        tabsToRender = tabsToRender.filter(tab => tab.groupId === currentGroupId);
    }
    
    // Sort tabs? Currently they rely on object insertion order, which is usually consistent in JS for non-integer keys.
    // Ideally we would have an 'order' field but for now insertion order is used.

    tabsToRender.forEach(tab => {
        const tabElement = document.createElement('div');
        tabElement.className = `tab ${tab.id === currentTabId ? 'active' : ''}`;
        tabElement.dataset.tabId = tab.id;
        tabElement.draggable = true; // Enable dragging

        // Tab drag events
        tabElement.addEventListener('dragstart', handleTabDragStart);
        tabElement.addEventListener('dragover', handleTabDragOver);
        tabElement.addEventListener('drop', handleTabDrop);
        tabElement.addEventListener('dragend', handleTabDragEnd);

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

        // Close button (only if more than one tab AND it is the current tab)
        if (Object.keys(tabs).length > 1 && tab.id === currentTabId) {
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
        if (isDoneCollapsed) {
            doneContainer.classList.add('collapsed');
        } else {
            doneContainer.classList.remove('collapsed');
        }

        // Show "Delete all" button if there's more than one completed task
        if (completedTasks.length > 1) {
            deleteAllBtn.classList.remove('hidden');
        } else {
            deleteAllBtn.classList.add('hidden');
        }

        // Calculate and display total time spent
        const totalTimeMs = completedTasks.reduce((total, task) => {
            return total + (task.actualDuration || 0);
        }, 0);

        if (totalTimeMs > 0) {
            const totalMinutes = Math.round(totalTimeMs / (1000 * 60));
            const hours = Math.floor(totalMinutes / 60);
            const minutes = totalMinutes % 60;
            
            let timeString = 'Time spent: ';
            if (hours > 0) {
                timeString += `${hours}hr `;
            }
            timeString += `${minutes}m`;
            
            doneTimeSpent.textContent = timeString;
            doneTimeSpent.style.display = 'block';
        } else {
            doneTimeSpent.style.display = 'none';
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
    } else if (task.completed) {
         // Completed but no duration set? Allow adding it.
         metaHtml = `<span class="task-meta add-time" title="Add actual duration">+</span>`;
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
    if (taskTextSpan) {
        taskTextSpan.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent triggering other click handlers on the task item
            editTaskText(task.id, taskTextSpan);
        });
    }

    const taskMetaSpan = taskElement.querySelector('.task-meta');
    if (taskMetaSpan) {
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
            // Check if we are creating a group
            if (tabNameModal.dataset.mode === 'group' || tabNameModal.dataset.mode === 'group-rename') {
                handleModalCreate();
                return;
            }

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
        // Set toggle state
        const groupsToggle = document.getElementById('enable-groups-toggle');
        if (groupsToggle) {
            groupsToggle.checked = enableGroups;
        }
    });

    // Groups toggle listener
    const groupsToggle = document.getElementById('enable-groups-toggle');
    if (groupsToggle) {
        groupsToggle.addEventListener('change', (e) => {
            enableGroups = e.target.checked;
            saveData();
            renderGroups();
            renderTabs();
            
            // If we just enabled groups, ensure we are in a valid state
            if (enableGroups) {
                if (!currentGroupId || !groups[currentGroupId]) {
                    // Fallback to first group or create default
                    if (Object.keys(groups).length > 0) {
                         switchToGroup(Object.keys(groups)[0]);
                    } else {
                         createGroup('General');
                    }
                } else {
                    // Re-select current group to filter tabs correctly
                    switchToGroup(currentGroupId);
                }
            }
        });
    }

    closeSettingsBtn.addEventListener('click', () => {
        settingsModal.classList.add('hidden');
    });

    // Delete Confirm Modal buttons
    if (cancelDeleteBtn) {
        cancelDeleteBtn.addEventListener('click', () => {
            hideDeleteConfirmModal();
        });
    }

    if (confirmDeleteBtn) {
        confirmDeleteBtn.addEventListener('click', () => {
            if (pendingDeleteTabId) {
                performTabDeletion(pendingDeleteTabId);
            } else if (pendingDeleteGroupId) {
                performGroupDeletion(pendingDeleteGroupId);
            }
            hideDeleteConfirmModal();
        });
    }

    // Close delete confirm modal when clicking outside
    if (deleteConfirmModal) {
        deleteConfirmModal.addEventListener('click', (e) => {
            if (e.target === deleteConfirmModal) {
                hideDeleteConfirmModal();
            }
        });
    }

    // Undo Events
    if (undoBtn) {
        undoBtn.addEventListener('click', performUndo);
    }
    
    if (closeUndoBtn) {
        closeUndoBtn.addEventListener('click', hideUndoToast);
    }

    connectBcBtn.addEventListener('click', async () => {
        const accountId = bcAccountIdInput.value.trim();
        const token = bcAccessTokenInput.value.trim();
        const refreshToken = bcRefreshTokenInput.value.trim();
        const clientId = bcClientIdInput.value.trim();
        const clientSecret = bcClientSecretInput.value.trim();
        const email = bcEmailInput.value.trim();
        
        if (accountId && token) {
            basecampConfig.accountId = accountId;
            basecampConfig.accessToken = token;
            basecampConfig.refreshToken = refreshToken || null;
            basecampConfig.clientId = clientId || null;
            basecampConfig.clientSecret = clientSecret || null;
            basecampConfig.email = email;
            basecampConfig.isConnected = true;
            saveData();
            updateBasecampUI();
            settingsModal.classList.add('hidden');
        }
    });

    disconnectBcBtn.addEventListener('click', () => {
        basecampConfig.accountId = null;
        basecampConfig.accessToken = null;
        basecampConfig.refreshToken = null;
        basecampConfig.clientId = null;
        basecampConfig.clientSecret = null;
        basecampConfig.email = null;
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

    // New OAuth Button
    if (oauthConnectBtn) {
        oauthConnectBtn.addEventListener('click', () => {
            oauthConnectBtn.textContent = 'Connecting...';
            oauthConnectBtn.disabled = true;
            ipcRenderer.send('start-basecamp-auth');
        });
    }

    // Toggle Manual Fields
    if (toggleManualAuthBtn) {
        toggleManualAuthBtn.addEventListener('click', (e) => {
            e.preventDefault();
            manualAuthFields.classList.toggle('hidden');
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
        const isGroupMode = tabNameModal.dataset.mode === 'group';
        
        if (projectId) {
            if (isGroupMode) {
                // Group creation: Pre-fill name and change button text
                const projectOption = bcProjectSelect.options[bcProjectSelect.selectedIndex];
                if (projectOption && (!tabNameInput.value || tabNameInput.value === '')) {
                    tabNameInput.value = projectOption.text;
                }
                createTabBtn.textContent = 'Import to-do lists from project';
                // Don't fetch lists into the dropdown for groups
                bcListWrapper.classList.add('hidden');
            } else {
                // Tab creation: fetch lists into dropdown
                fetchBasecampTodoLists(projectId);
                bcListWrapper.classList.remove('hidden');
            }
        } else {
            bcListWrapper.classList.add('hidden');
            if (isGroupMode) {
                createTabBtn.textContent = 'Create Group';
            }
        }
    });

    // Auto-fill tab name when Basecamp list is selected
    bcListSelect.addEventListener('change', () => {
        const selectedOption = bcListSelect.options[bcListSelect.selectedIndex];
        if (selectedOption && bcListSelect.value) {
            const projectOption = bcProjectSelect.options[bcProjectSelect.selectedIndex];
            let prefix = '';
            
            if (projectOption) {
                const projectName = projectOption.text;
                const firstWord = projectName.trim().split(/\s+/)[0]; // Handle multiple spaces
                if (firstWord) {
                    prefix = `${firstWord}: `;
                }
            }
            
            tabNameInput.value = prefix + selectedOption.text;
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

    // Handle all external links
    document.addEventListener('click', (event) => {
        if (event.target.tagName === 'A' && event.target.href.startsWith('http')) {
            event.preventDefault();
            shell.openExternal(event.target.href);
        }
    });

    // Close modal or exit fullscreen on Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (!tabNameModal.classList.contains('hidden')) {
                hideTabNameModal();
                return;
            }
            if (!settingsModal.classList.contains('hidden')) {
                settingsModal.classList.add('hidden');
                return;
            }
            if (!deleteConfirmModal.classList.contains('hidden')) {
                hideDeleteConfirmModal();
                return;
            }
            
            // Exit fullscreen focus mode if active
            const focusContainer = document.querySelector('.focus-container');
            if (focusContainer && focusContainer.classList.contains('fullscreen')) {
                focusContainer.classList.remove('fullscreen');
                updateFullscreenButtonState(false);
                // Restore standard width (similar to logic in fullscreen button handler)
                ipcRenderer.send('set-focus-window-size', Math.min(Math.max(focusContainer.offsetWidth, 280), 500));
            }
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

    // Done section toggle
    const doneHeading = document.getElementById('done-heading');
    if (doneHeading) {
        doneHeading.addEventListener('click', (e) => {
            // Don't toggle if clicking the delete button
            if (e.target.closest('.delete-all-btn')) return;
            
            isDoneCollapsed = !isDoneCollapsed;
            if (isDoneCollapsed) {
                doneContainer.classList.add('collapsed');
            } else {
                doneContainer.classList.remove('collapsed');
            }
            saveData();
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
        } else if (e.target.classList.contains('task-text')) {
            // Edit task text for completed tasks
            editTaskText(taskId, e.target);
        } else if (e.target.classList.contains('task-meta') || e.target.closest('.task-meta')) {
             // Edit task duration for completed tasks
             const metaEl = e.target.classList.contains('task-meta') ? e.target : e.target.closest('.task-meta');
             editTaskDuration(taskId, metaEl);
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

        // Check if we are in fullscreen mode
        const focusContainer = document.querySelector('.focus-container');
        if (focusContainer && focusContainer.classList.contains('fullscreen')) {
            // First exit fullscreen locally
            focusContainer.classList.remove('fullscreen');
            // Restore standard width so IPC doesn't get confused
            ipcRenderer.send('set-focus-window-size', Math.min(Math.max(focusContainer.offsetWidth, 280), 500));
            // Then continue to standard exit
        }

        exitFocusMode();
    });

    completeFocusBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        // Check if we are in fullscreen mode and exit it correctly
        const focusContainer = document.querySelector('.focus-container');
        if (focusContainer && focusContainer.classList.contains('fullscreen')) {
            // First exit fullscreen locally
            focusContainer.classList.remove('fullscreen');
            // Restore standard width so IPC doesn't get confused
            ipcRenderer.send('set-focus-window-size', Math.min(Math.max(focusContainer.offsetWidth, 280), 500));
        }

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

    if (resetFocusBtn) {
        resetFocusBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            // Reset timer to start from 0
            focusStartTime = Date.now();
            updateFocusTimer();
        });
    }

    if (fullscreenFocusBtn) {
        fullscreenFocusBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            const focusContainer = document.querySelector('.focus-container');
            if (focusContainer.classList.contains('fullscreen')) {
                // Exit fullscreen
                focusContainer.classList.remove('fullscreen');
                updateFullscreenButtonState(false);
                // Restore window size logic would be complex without knowing original state, 
                // but we can rely on the standard focus mode sizing logic which runs on enter or resize
                // Actually, we should probably just tell main process to exit kiosk/fullscreen
                ipcRenderer.send('set-focus-window-size', Math.min(Math.max(focusContainer.offsetWidth, 280), 500)); // Restore standard width
            } else {
                // Enter fullscreen
                focusContainer.classList.add('fullscreen');
                updateFullscreenButtonState(true);
                ipcRenderer.send('enter-fullscreen-focus');
            }
        });
    }

    // Delete all completed tasks
    if (deleteAllBtn) {
        deleteAllBtn.addEventListener('click', () => {
            if (!currentTabId || !tabs[currentTabId]) return;
            
            const currentTab = tabs[currentTabId];

            // If connected to Basecamp, delete all completed tasks remotely
            if (currentTab.basecampListId && basecampConfig.isConnected) {
                const completedTasks = currentTab.tasks.filter(task => task.completed && task.basecampId);
                completedTasks.forEach(task => {
                    deleteBasecampTodo(currentTabId, task.basecampId);
                });
            }
            
            // Keep only incomplete tasks
            tabs[currentTabId].tasks = tabs[currentTabId].tasks.filter(task => !task.completed);
            saveData();
            renderTasks();
        });
    }

    // Custom drag implementation removed in favor of -webkit-app-region: drag
    /* 
    const focusContainer = document.querySelector('.focus-container');
    if (focusContainer) {
        // Drag logic removed
    } 
    */

    // Window controls (Min/Max/Close)
    const minBtn = document.getElementById('min-btn');
    const maxBtn = document.getElementById('max-btn');
    const closeBtn = document.getElementById('close-btn');

    if (minBtn) {
        minBtn.addEventListener('click', () => {
            ipcRenderer.send('window-minimize');
        });
    }

    if (maxBtn) {
        maxBtn.addEventListener('click', () => {
            ipcRenderer.send('window-maximize');
        });
    }

    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            ipcRenderer.send('window-close');
        });
    }

    // Add Task Resizer
    const resizer = document.getElementById('add-task-resizer');
    if (resizer) {
        let startY, startMaxHeight;
        
        resizer.addEventListener('mousedown', (e) => {
            startY = e.clientY;
            // Ensure we have a number
            startMaxHeight = parseInt(window.getComputedStyle(doneContainer).maxHeight) || doneMaxHeight;
            
            document.documentElement.style.cursor = 'row-resize';
            resizer.classList.add('dragging');
            
            const handleMouseMove = (e) => {
                const deltaY = startY - e.clientY; // Drag up = positive delta
                // If dragging up, max height increases. If dragging down, decreases.
                // Dragging UP means e.clientY is SMALLER than startY. So startY - clientY > 0.
                // This matches: dragging up increases done section size.
                
                let newHeight = startMaxHeight + deltaY;
                
                // Constraints
                if (newHeight < 24) newHeight = 24; // Minimum height (heading size)
                if (newHeight > window.innerHeight - 150) newHeight = window.innerHeight - 150; // Max constraint
                
                doneMaxHeight = newHeight;
                doneContainer.style.maxHeight = `${newHeight}px`;
            };
            
            const handleMouseUp = () => {
                document.removeEventListener('mousemove', handleMouseMove);
                document.removeEventListener('mouseup', handleMouseUp);
                document.documentElement.style.cursor = '';
                resizer.classList.remove('dragging');
                saveData(); // Persist the new preference
            };
            
            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
        });
    }
}

// Focus mode functions
function updateFullscreenButtonState(isFullscreen) {
    const btn = document.getElementById('fullscreen-focus-btn');
    if (!btn) return;
    
    const path = btn.querySelector('path');
    if (isFullscreen) {
        // Collapse icon (arrows pointing inwards)
        path.setAttribute('d', 'M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7');
        btn.title = 'Exit fullscreen';
    } else {
        // Expand icon (arrows pointing outwards)
        path.setAttribute('d', 'M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7');
        btn.title = 'Enter fullscreen';
    }
}

function enterFocusMode(taskName, duration = null, initialTimeSpent = 0) {
    console.log('enterFocusMode called with taskName:', taskName, 'duration:', duration, 'initialTimeSpent:', initialTimeSpent);
    isFocusMode = true;
    focusDuration = duration; // Set the duration
    
    console.log('Hiding normal mode, showing focus mode');
    normalMode.classList.add('hidden');
    focusMode.classList.remove('hidden');

    // Reset fullscreen state if present (ensure we start fresh)
    const container = document.querySelector('.focus-container');
    if (container) {
        container.classList.remove('fullscreen');
        updateFullscreenButtonState(false);
    }

    focusTaskName.textContent = taskName;
    focusTaskName.title = taskName;

    console.log('Starting focus timer');
    startFocusTimer(initialTimeSpent);

    // Calculate appropriate window width based on content
    setTimeout(() => {
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
            
            // If connected to Basecamp and task has a remote ID, sync the change
            if (currentTab.basecampListId && basecampConfig.isConnected && task.basecampId) {
                updateBasecampTodoText(currentTabId, task);
            }
            
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
    // Determine what value to show: actualDuration (ms) converted to minutes, or expectedDuration
    let initialValue = '';
    if (task.completed && task.actualDuration) {
        initialValue = Math.round(task.actualDuration / (1000 * 60));
    } else {
        initialValue = task.expectedDuration || '';
    }
    
    input.value = initialValue;
    input.className = 'task-edit-input';
    input.style.width = '50px';
    input.style.textAlign = 'center';
    input.min = '0'; // Allow 0 to clear or low values
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
            const minutes = parseInt(newVal);
            if (task.completed) {
                // If completed, update actualDuration (store as ms)
                task.actualDuration = minutes * 60 * 1000;
            } else {
                // If not completed, update expectedDuration
                task.expectedDuration = minutes;
            }
        } else {
            // If empty, clear value
            if (task.completed) {
                task.actualDuration = null;
            } else {
                task.expectedDuration = null;
            }
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

function showDeleteConfirmModal(tabId, message) {
    pendingDeleteTabId = tabId;
    pendingDeleteGroupId = null;
    deleteConfirmMessage.innerHTML = message;
    deleteConfirmModal.classList.remove('hidden');
}

function showGroupDeleteConfirmModal(groupId, message) {
    pendingDeleteGroupId = groupId;
    pendingDeleteTabId = null;
    deleteConfirmMessage.innerHTML = message;
    deleteConfirmModal.classList.remove('hidden');
}

function hideDeleteConfirmModal() {
    deleteConfirmModal.classList.add('hidden');
    pendingDeleteTabId = null;
    pendingDeleteGroupId = null;
}

// IPC listeners
ipcRenderer.on('enter-focus-mode', (event, taskName) => {
    enterFocusMode(taskName);
});

ipcRenderer.on('exit-focus-mode', () => {
    exitFocusMode();
});

// Basecamp Authentication Logic
ipcRenderer.on('basecamp-auth-success', async (event, data) => {
    console.log('Auth success, tokens received');
    
    basecampConfig.accessToken = data.access_token;
    basecampConfig.refreshToken = data.refresh_token;
    basecampConfig.clientId = data.client_id;
    basecampConfig.clientSecret = data.client_secret;
    
    // Now we need to get the account ID (Identity)
    await fetchBasecampIdentity();
    
    basecampConfig.isConnected = true;
    saveData();
    updateBasecampUI();
    
    // Reset button
    if (oauthConnectBtn) {
        oauthConnectBtn.innerHTML = '<img src="images/basecamp_logo_icon_147315.png" width="16" height="16" style="filter: brightness(0) invert(1); margin-right: 8px;"> Connect with Basecamp';
        oauthConnectBtn.disabled = false;
    }
});

ipcRenderer.on('basecamp-auth-error', (event, errorMessage) => {
    alert('Authentication failed: ' + errorMessage);
    if (oauthConnectBtn) {
        oauthConnectBtn.textContent = 'Connect with Basecamp';
        oauthConnectBtn.disabled = false;
    }
});

// Data persistence
function saveData() {
    const data = {
        tabs: tabs,
        currentTabId: currentTabId,
        taskCounter: taskCounter,
        basecampConfig: basecampConfig,
        isDoneCollapsed: isDoneCollapsed,
        doneMaxHeight: doneMaxHeight,
        groups: groups,
        currentGroupId: currentGroupId,
        enableGroups: enableGroups
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
            basecampConfig = data.basecampConfig || { 
                accountId: null, 
                accessToken: null, 
                refreshToken: null,
                clientId: null,
                clientSecret: null,
                email: null, 
                isConnected: false 
            };
            isDoneCollapsed = data.isDoneCollapsed || false;
            doneMaxHeight = data.doneMaxHeight || 140;
            groups = data.groups || {};
            currentGroupId = data.currentGroupId || null;
            enableGroups = data.enableGroups !== undefined ? data.enableGroups : (Object.keys(groups).length > 0); // Default to true if groups exist, else false
        }
    } catch (e) {
        console.error('Failed to load data:', e);
    }
}

// New function to fetch identity/accounts
async function fetchBasecampIdentity() {
    try {
        const response = await fetch('https://launchpad.37signals.com/authorization.json', {
            headers: {
                'Authorization': `Bearer ${basecampConfig.accessToken}`
            }
        });
        
        if (!response.ok) throw new Error('Failed to fetch identity');
        
        const data = await response.json();
        const accounts = data.accounts;
        
        if (accounts && accounts.length > 0) {
            // For now, default to the first account. 
            // Ideally we'd let the user choose if > 1, but this is a good start.
            const account = accounts[0];
            basecampConfig.accountId = account.id;
            basecampConfig.email = data.identity.email_address;
            console.log(`Connected to account: ${account.name} (${account.id})`);
        } else {
            throw new Error('No Basecamp accounts found for this user.');
        }
    } catch (e) {
        console.error('Identity Error:', e);
        alert('Could not fetch Basecamp account details. Please try again.');
    }
}

// Basecamp API Logic
function updateBasecampUI() {
    if (basecampConfig.isConnected) {
        bcConnectionStatus.classList.remove('hidden');
        bcLoginForm.classList.add('hidden');
        disconnectBcBtn.classList.remove('hidden');
        
        // Show account info if available
        if (bcAccountInfo && basecampConfig.accountId) {
            bcAccountInfo.textContent = `Account ID: ${basecampConfig.accountId} ${basecampConfig.email ? `(${basecampConfig.email})` : ''}`;
        }
        
        // Fill hidden inputs (legacy support)
        bcAccountIdInput.value = basecampConfig.accountId || '';
        bcAccessTokenInput.value = basecampConfig.accessToken || '';
        bcRefreshTokenInput.value = basecampConfig.refreshToken || '';
        bcClientIdInput.value = basecampConfig.clientId || '';
        bcClientSecretInput.value = basecampConfig.clientSecret || '';
        bcEmailInput.value = basecampConfig.email || '';
    } else {
        bcConnectionStatus.classList.add('hidden');
        bcLoginForm.classList.remove('hidden');
        disconnectBcBtn.classList.add('hidden');
        bcAccountIdInput.value = '';
        bcAccessTokenInput.value = '';
        bcRefreshTokenInput.value = '';
        bcClientIdInput.value = '';
        bcClientSecretInput.value = '';
        bcEmailInput.value = '';
    }
}

async function refreshBasecampToken() {
    if (!basecampConfig.refreshToken || !basecampConfig.clientId || !basecampConfig.clientSecret) {
        console.warn('Cannot refresh token: Missing refresh token or client credentials.');
        return false;
    }

    try {
        const response = await fetch(`https://launchpad.37signals.com/authorization/token?type=refresh&refresh_token=${encodeURIComponent(basecampConfig.refreshToken)}&client_id=${encodeURIComponent(basecampConfig.clientId)}&client_secret=${encodeURIComponent(basecampConfig.clientSecret)}`, {
            method: 'POST'
        });

        if (!response.ok) {
            console.error(`Token refresh failed: ${response.status} ${response.statusText}`);
            return false;
        }

        const data = await response.json();
        if (data.access_token) {
            basecampConfig.accessToken = data.access_token;
            // Update refresh token if provided (rare but possible)
            if (data.refresh_token) {
                basecampConfig.refreshToken = data.refresh_token;
            }
            saveData();
            updateBasecampUI();
            console.log('Basecamp token refreshed successfully.');
            return true;
        }
    } catch (e) {
        console.error('Error refreshing Basecamp token:', e);
    }
    return false;
}

async function basecampFetch(url, options = {}) {
    // Ensure headers exist
    if (!options.headers) options.headers = {};
    
    // Add Authorization header
    options.headers['Authorization'] = `Bearer ${basecampConfig.accessToken}`;

    // First attempt
    let response = await fetch(url, options);

    // If 401, try to refresh
    if (response.status === 401) {
        console.log('Received 401 from Basecamp. Attempting to refresh token...');
        const refreshed = await refreshBasecampToken();
        
        if (refreshed) {
            // Update header with new token
            options.headers['Authorization'] = `Bearer ${basecampConfig.accessToken}`;
            // Retry request
            response = await fetch(url, options);
        } else {
            console.error('Failed to refresh token or no refresh credentials available.');
        }
    }

    return response;
}

async function checkProjectAccess(projectId, email) {
    try {
        const response = await basecampFetch(`https://3.basecampapi.com/${basecampConfig.accountId}/projects/${projectId}/people.json`, {
            headers: {
                'Content-Type': 'application/json'
            }
        });
        if (!response.ok) return false;
        const people = await response.json();
        return people.some(p => p.email_address && p.email_address.toLowerCase() === email.toLowerCase());
    } catch (e) {
        console.error(`Error checking access for project ${projectId}:`, e);
        return false;
    }
}

async function fetchBasecampProjects() {
    if (!basecampConfig.isConnected) return [];
    try {
        // Basecamp 3 API: GET /projects.json
        const response = await basecampFetch(`https://3.basecampapi.com/${basecampConfig.accountId}/projects.json`, {
            headers: {
                'Content-Type': 'application/json'
            }
        });
        if (!response.ok) throw new Error('Failed to fetch projects');
        let projects = await response.json();

        // Filter by email if provided
        if (basecampConfig.email && basecampConfig.email.trim()) {
            const email = basecampConfig.email.trim();
            
            // Check access for all projects in parallel
            // Note: This might hit rate limits if there are many projects
            const accessResults = await Promise.all(
                projects.map(async (p) => {
                    const hasAccess = await checkProjectAccess(p.id, email);
                    return hasAccess ? p : null;
                })
            );
            projects = accessResults.filter(p => p !== null);
        }

        return projects;
    } catch (e) {
        console.error('Basecamp Error:', e);
        return [];
    }
}

async function getBasecampTodoLists(projectId) {
    try {
        // 1. Get the "todoset" (dock) for the project
        const projectResp = await basecampFetch(`https://3.basecampapi.com/${basecampConfig.accountId}/projects/${projectId}.json`);
        const projectData = await projectResp.json();
        
        const todoset = projectData.dock.find(d => d.name === 'todoset');
        if (!todoset) return [];

        // 2. Get the todolists in that set
        // In BC3, we need to follow the url to get the set details which contains 'todolists_url'
        // Actually: GET /buckets/1/todosets/1/todolists.json is the pattern
        const realListsUrl = todoset.url.replace('.json', '/todolists.json');
        
        const finalListsResp = await basecampFetch(realListsUrl);
        const finalLists = await finalListsResp.json();

        return finalLists;
    } catch (e) {
        console.error('Basecamp Lists Error:', e);
        return [];
    }
}

async function fetchBasecampTodoLists(projectId) {
    const lists = await getBasecampTodoLists(projectId);
    
    // Populate select
    bcListSelect.innerHTML = '<option value="">Select a list...</option>';
    
    lists.forEach(list => {
        const opt = document.createElement('option');
        opt.value = list.id;
        opt.textContent = list.name;
        bcListSelect.appendChild(opt);
    });
}

async function syncBasecampList(tabId) {
    const tab = tabs[tabId];
    if (!tab || !tab.basecampListId || !basecampConfig.isConnected) return;

    try {
        // Fetch both active (default) and completed todos
        const baseUrl = `https://3.basecampapi.com/${basecampConfig.accountId}/buckets/${tab.basecampProjectId}/todolists/${tab.basecampListId}/todos.json`;
        
        const [activeResp, completedResp] = await Promise.all([
            basecampFetch(baseUrl),
            basecampFetch(`${baseUrl}?completed=true`)
        ]);

        const activeTodos = await activeResp.json();
        const completedTodos = await completedResp.json();
        const remoteTodos = [...activeTodos, ...completedTodos];

        // Merge logic: 
        // 1. Add new remote todos to local
        // 2. Update status of linked todos
        
        let changes = false;
        const remoteIds = new Set();

        remoteTodos.forEach(remote => {
            remoteIds.add(remote.id);
            const localTask = tab.tasks.find(t => t.basecampId === remote.id);
            
            if (localTask) {
                // Update local status if remote changed
                if (localTask.completed !== remote.completed) {
                    localTask.completed = remote.completed;
                    changes = true;
                }
                // Update text if remote changed
                if (localTask.text !== remote.content) {
                    localTask.text = remote.content;
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

        // 3. Remove local tasks that are linked to Basecamp but no longer exist remotely
        const initialCount = tab.tasks.length;
        tab.tasks = tab.tasks.filter(t => !t.basecampId || remoteIds.has(t.basecampId));
        
        if (tab.tasks.length !== initialCount) {
            changes = true;
        }

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
        
        await basecampFetch(url, {
            method: method
        });
    } catch (e) {
        console.error('Update BC Error:', e);
    }
}

async function updateBasecampTodoText(tabId, task) {
    const tab = tabs[tabId];
    if (!tab || !task.basecampId) return;

    try {
        const url = `https://3.basecampapi.com/${basecampConfig.accountId}/buckets/${tab.basecampProjectId}/todos/${task.basecampId}.json`;
        
        await basecampFetch(url, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ content: task.text })
        });
    } catch (e) {
        console.error('Update BC Text Error:', e);
    }
}

async function deleteBasecampTodo(tabId, basecampId) {
    const tab = tabs[tabId];
    if (!tab || !tab.basecampProjectId || !basecampConfig.isConnected) return;

    try {
        const url = `https://3.basecampapi.com/${basecampConfig.accountId}/buckets/${tab.basecampProjectId}/todos/${basecampId}.json`;
        
        await basecampFetch(url, {
            method: 'DELETE'
        });
    } catch (e) {
        console.error('Delete BC Error:', e);
    }
}

async function createBasecampTodo(tabId, task) {
    const tab = tabs[tabId];
    if (!tab || !tab.basecampListId) return;

    try {
        const url = `https://3.basecampapi.com/${basecampConfig.accountId}/buckets/${tab.basecampProjectId}/todolists/${tab.basecampListId}/todos.json`;
        const response = await basecampFetch(url, {
            method: 'POST',
            headers: {
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
