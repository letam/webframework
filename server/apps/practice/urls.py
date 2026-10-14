"""Practice room urls."""

from django.urls import path

from . import views

urlpatterns = [
    path('capabilities/', views.capabilities),
    path('rooms/', views.rooms),
    path('rooms/<uuid:room_id>/', views.room),
    path('rooms/<uuid:room_id>/join/', views.join),
    path('rooms/<uuid:room_id>/leave/', views.leave),
    path('rooms/<uuid:room_id>/invite/rotate/', views.rotate),
    path('rooms/<uuid:room_id>/invite/revoke/', views.revoke_invitation),
    path('rooms/<uuid:room_id>/members/<int:member_id>/revoke/', views.revoke_member),
]
